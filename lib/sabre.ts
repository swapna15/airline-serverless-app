import axios, { AxiosError } from 'axios'
import { randomUUID } from 'crypto'

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface FlightSearchParams {
  originLocationCode: string
  destinationLocationCode: string
  departureDate: string // YYYY-MM-DD
  adults: number
  currencyCode: 'USD'
  max: number
}

// Sabre /v1/offers/flightShop/ offer shape
export interface SabreFlightOffer {
  id: string
  source: string
  itineraries: unknown[]
  price: { total: string; currency: string }
}

export interface PricedOffer extends SabreFlightOffer {
  confirmedAt: string // ISO timestamp
}

// Sabre flight status response shape
export interface SabreFlightStatus {
  flightDesignator: { carrierCode: string; flightNumber: string }
  scheduledDepartureDate: string
  legs: unknown[]
  flightStatus?: string
  delays?: { departureDelayMinutes?: number; arrivalDelayMinutes?: number }
}

// Sabre /v1/offers/flightShop/ response shape
interface SabreFlightShopResponse {
  timestamp?: string
  offers?: SabreFlightShopOffer[]
}

interface SabreFlightShopOffer {
  offerId?: string
  price?: { totalPrice?: number; currency?: string; total?: string }
  journeys?: unknown[]
  travelers?: unknown[]
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  expires_in: number // seconds
}

interface CachedToken {
  value: string
  expiresAt: number // ms epoch
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [1000, 2000, 4000] // exponential backoff: 1s, 2s, 4s
const PROACTIVE_REFRESH_THRESHOLD_MS = 60_000 // 60 seconds

// Sabre error codes for quota/rate exhaustion
const QUOTA_EXHAUSTED_CODES = new Set(['ERR.SYSTEM.QUOTA_EXCEEDED', 'QUOTA_EXCEEDED'])

// ─── SabreClient ─────────────────────────────────────────────────────────────

export class SabreClient {
  private readonly baseUrl: string
  private readonly username: string
  private readonly password: string
  private cachedToken: CachedToken | null = null

  constructor(
    username: string,
    password: string,
    env: 'cert' | 'production' = 'cert'
  ) {
    this.username = username
    this.password = password
    this.baseUrl =
      env === 'production'
        ? 'https://api.platform.sabre.com'
        : 'https://api.cert.platform.sabre.com'
  }

  // ── Token management ────────────────────────────────────────────────────────

  async getToken(): Promise<string> {
    const now = Date.now()

    // Proactively refresh when within 60 seconds of expiry (or no token yet)
    if (
      !this.cachedToken ||
      this.cachedToken.expiresAt - now <= PROACTIVE_REFRESH_THRESHOLD_MS
    ) {
      await this.refreshToken()
    }

    return this.cachedToken!.value
  }

  private async refreshToken(): Promise<void> {
    // Sabre uses a triple base64 encoding scheme:
    // 1. base64("V1:{username}:{PCC}:AA")  → encodedClientId
    // 2. base64(password)                  → encodedPassword
    // 3. base64("{encodedClientId}:{encodedPassword}") → Authorization header value
    //
    // The username from Sabre Dev Studio is in the format: V1:{EPR}:{PCC}:AA
    // If SABRE_USERNAME already starts with "V1:" it is used as-is,
    // otherwise it is wrapped: "V1:{username}:{PCC}:AA"
    const pcc = process.env.SABRE_PCC ?? 'TEST'
    const rawUserId = this.username.startsWith('V1:')
      ? this.username
      : `V1:${this.username}:${pcc}:AA`

    const encodedClientId = Buffer.from(rawUserId).toString('base64')
    const encodedPassword = Buffer.from(this.password).toString('base64')
    const combined = Buffer.from(`${encodedClientId}:${encodedPassword}`).toString('base64')

    const params = new URLSearchParams()
    params.append('grant_type', 'client_credentials')

    const response = await axios.post<TokenResponse>(
      `${this.baseUrl}/v2/auth/token`,
      params,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${combined}`,
        },
      }
    )

    const { access_token, expires_in } = response.data
    this.cachedToken = {
      value: access_token,
      expiresAt: Date.now() + expires_in * 1000,
    }
  }

  // ── Sleep (overridable in tests) ─────────────────────────────────────────────

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // ── Retry helper ─────────────────────────────────────────────────────────────

  private async withRetry<T>(
    fn: () => Promise<T>,
    correlationId: string
  ): Promise<T> {
    let lastError: unknown

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
        const status = this.extractStatus(err)
        const sabreCode = this.extractSabreCode(err)

        // Check for quota exhaustion — stop retrying immediately
        if (sabreCode && QUOTA_EXHAUSTED_CODES.has(sabreCode)) {
          console.error(
            JSON.stringify({
              correlationId,
              event: 'sabre_quota_exhausted',
              sabreCode,
              status,
            })
          )
          throw err
        }

        const isRetryable =
          status === 429 || (status !== null && status >= 500) || status === null

        if (!isRetryable || attempt === RETRY_DELAYS_MS.length) {
          console.error(
            JSON.stringify({
              correlationId,
              event: 'sabre_error',
              status,
              sabreCode,
              attempt,
            })
          )
          throw err
        }

        await this.sleep(RETRY_DELAYS_MS[attempt])
      }
    }

    throw lastError
  }

  private extractStatus(err: unknown): number | null {
    if (err instanceof AxiosError && err.response) {
      return err.response.status
    }
    if (
      err &&
      typeof err === 'object' &&
      'isAxiosError' in err &&
      (err as Record<string, unknown>).isAxiosError === true
    ) {
      const response = (err as Record<string, unknown>).response as Record<string, unknown> | undefined
      if (response && typeof response.status === 'number') {
        return response.status
      }
    }
    return null
  }

  private extractSabreCode(err: unknown): string | null {
    const tryExtract = (data: Record<string, unknown>): string | null => {
      // Sabre error shape: { errors: [{ code, message }] } or { ApplicationResults: { Error: [{ Code }] } }
      const errors = data.errors
      if (Array.isArray(errors) && errors.length > 0) {
        const first = errors[0] as Record<string, unknown>
        return String(first.code ?? first.Code ?? '')
      }
      const appResults = data.ApplicationResults as Record<string, unknown> | undefined
      if (appResults?.Error) {
        const errs = appResults.Error as Array<Record<string, unknown>>
        if (errs.length > 0) return String(errs[0].Code ?? '')
      }
      return null
    }

    if (err instanceof AxiosError && err.response?.data) {
      return tryExtract(err.response.data as Record<string, unknown>)
    }
    if (
      err &&
      typeof err === 'object' &&
      'isAxiosError' in err &&
      (err as Record<string, unknown>).isAxiosError === true
    ) {
      const response = (err as Record<string, unknown>).response as Record<string, unknown> | undefined
      if (response?.data) return tryExtract(response.data as Record<string, unknown>)
    }
    return null
  }

  // ── Public API methods ───────────────────────────────────────────────────────

  /**
   * Search for flight offers using Sabre Offers API.
   * POST /v1/offers/flightShop/
   * Uses the modern Offers & Orders schema (not OTA-wrapped).
   */
  async searchFlightOffers(
    params: FlightSearchParams
  ): Promise<SabreFlightOffer[]> {
    const correlationId = randomUUID()
    const token = await this.getToken()

    return this.withRetry(async () => {
      const requestBody = {
        pointOfSale: {
          location: { countryCode: 'US', cityCode: params.originLocationCode },
          agentDutyCode: '*',
        },
        journeys: [{
          departureLocation: { airportCode: params.originLocationCode },
          arrivalLocation: { airportCode: params.destinationLocationCode },
          departureDate: params.departureDate,
        }],
        travelers: Array.from({ length: params.adults }, (_, i) => ({
          id: String(i + 1),
          passengerTypeCode: 'ADT',
        })),
        cabin: 'ECONOMY',
        currency: params.currencyCode,
      }

      const response = await axios.post<SabreFlightShopResponse>(
        `${this.baseUrl}/v1/offers/flightShop/`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        }
      )

      return this.mapFlightShopResponse(response.data, params.max)
    }, correlationId)
  }

  /**
   * Confirm/reprice a flight offer using Sabre Price Air Itinerary.
   * POST /v1/air/revalidate-itinerary
   */
  async priceFlightOffer(offer: SabreFlightOffer): Promise<PricedOffer> {
    const correlationId = randomUUID()
    const token = await this.getToken()

    return this.withRetry(async () => {
      const requestBody = {
        RevalidateItinRQ: {
          Version: '1',
          itinerary: offer,
        },
      }

      const response = await axios.post<{ RevalidateItinRS?: { itinerary?: SabreFlightOffer } }>(
        `${this.baseUrl}/v1/air/revalidate-itinerary`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      )

      const priced = response.data.RevalidateItinRS?.itinerary ?? offer
      return { ...priced, confirmedAt: new Date().toISOString() }
    }, correlationId)
  }

  /**
   * Get flight status using Sabre Flight Status API.
   * GET /v1/historical/flights/{carrierCode}{flightNumber}/status
   */
  async getFlightStatus(
    flightNumber: string,
    date: string
  ): Promise<SabreFlightStatus> {
    const correlationId = randomUUID()
    const token = await this.getToken()

    const carrierCode = flightNumber.replace(/\d+$/, '')
    const number = flightNumber.replace(/^\D+/, '')

    return this.withRetry(async () => {
      const response = await axios.get<{ flightStatusResponse?: { flightStatuses?: SabreFlightStatus[] } }>(
        `${this.baseUrl}/v1/historical/flights/${carrierCode}${number}/status`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { departureDate: date },
        }
      )

      const statuses = response.data.flightStatusResponse?.flightStatuses ?? []
      return statuses[0] ?? ({} as SabreFlightStatus)
    }, correlationId)
  }

  // ── Response mapping ─────────────────────────────────────────────────────────

  private mapFlightShopResponse(
    data: SabreFlightShopResponse,
    max: number
  ): SabreFlightOffer[] {
    const offers: SabreFlightOffer[] = []
    const rawOffers = data.offers ?? []

    for (const offer of rawOffers) {
      const price = offer.price
      const total = price?.total ?? String(price?.totalPrice ?? '0')
      const currency = price?.currency ?? 'USD'

      offers.push({
        id: offer.offerId ?? randomUUID(),
        source: 'SABRE',
        itineraries: offer.journeys ?? [],
        price: { total, currency },
      })

      if (offers.length >= max) break
    }

    return offers
  }
}

// ─── Mock Client ─────────────────────────────────────────────────────────────

/**
 * Returns realistic mock flight offers for local development when SABRE_ENV=mock.
 * Generates varied prices and times based on the route so results feel dynamic.
 */
export class SabreMockClient {
  searchFlightOffers(params: FlightSearchParams): Promise<SabreFlightOffer[]> {
    const { originLocationCode: from, destinationLocationCode: to, departureDate, max } = params

    // Seed a deterministic but varied price from the route string
    const routeSeed = (from + to).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
    const basePrice = 120 + (routeSeed % 300)

    const carriers = ['AA', 'UA', 'DL', 'B6', 'WN']
    const offers: SabreFlightOffer[] = []

    const count = Math.min(max, 5)
    for (let i = 0; i < count; i++) {
      const carrier = carriers[i % carriers.length]
      const flightNum = 1000 + (routeSeed % 500) + i * 17
      const depHour = 6 + i * 2
      const depTime = `${String(depHour).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`
      const durationHours = 2 + (routeSeed % 4)
      const arrHour = depHour + durationHours
      const arrTime = `${String(arrHour % 24).padStart(2, '0')}:${i % 2 === 0 ? '15' : '45'}`
      const price = (basePrice + i * 25 - (i === 2 ? 40 : 0)).toFixed(2)

      offers.push({
        id: `MOCK-${carrier}${flightNum}`,
        source: 'SABRE_MOCK',
        itineraries: [{
          segments: [{
            carrierCode: carrier,
            flightNumber: String(flightNum),
            departureAirport: from,
            arrivalAirport: to,
            departureDateTime: `${departureDate}T${depTime}:00`,
            arrivalDateTime: `${departureDate}T${arrTime}:00`,
          }],
        }],
        price: { total: price, currency: 'USD' },
      })
    }

    return Promise.resolve(offers)
  }

  priceFlightOffer(offer: SabreFlightOffer): Promise<PricedOffer> {
    return Promise.resolve({ ...offer, confirmedAt: new Date().toISOString() })
  }

  getFlightStatus(_flightNumber: string, _date: string): Promise<SabreFlightStatus> {
    return Promise.resolve({
      flightDesignator: { carrierCode: 'AA', flightNumber: '100' },
      scheduledDepartureDate: _date,
      legs: [],
      flightStatus: 'ON_TIME',
    })
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

function createSabreClient(): SabreClient | SabreMockClient {
  const env = process.env.SABRE_ENV

  if (env === 'mock') {
    return new SabreMockClient()
  }

  const username = process.env.SABRE_USERNAME ?? ''
  const password = process.env.SABRE_PASSWORD ?? ''
  const sabreEnv = env === 'production' ? 'production' : 'cert'

  return new SabreClient(username, password, sabreEnv)
}

// Re-evaluate on each import so SABRE_ENV changes take effect
export const sabreClient = createSabreClient()
