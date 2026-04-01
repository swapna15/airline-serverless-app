export type Fare = {
  route: string          // e.g. "ORD#JFK"
  departureDate: string  // YYYY-MM-DD
  cabinClass: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST'
  priceUsd: number       // positive, max 2 decimal places
  currency: string       // ISO 4217
  dataTimestamp: string  // ISO 8601
  offerId: string        // Amadeus offer ID
}

export type ParseError = {
  message: string
  field?: string
  raw?: unknown
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

const VALID_CABIN_CLASSES = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const

export function parseFare(raw: unknown): Result<Fare, ParseError> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    const err: ParseError = { message: 'Fare must be a non-null object', raw }
    console.error('[fare-parser] parse error', err)
    return { ok: false, error: err }
  }

  const obj = raw as Record<string, unknown>

  const requiredFields = ['route', 'departureDate', 'cabinClass', 'priceUsd', 'currency', 'dataTimestamp', 'offerId']
  for (const field of requiredFields) {
    if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
      const err: ParseError = { message: `Missing required field: ${field}`, field, raw }
      console.error('[fare-parser] parse error', err)
      return { ok: false, error: err }
    }
  }

  if (typeof obj.route !== 'string') {
    const err: ParseError = { message: 'Field "route" must be a string', field: 'route', raw }
    console.error('[fare-parser] parse error', err)
    return { ok: false, error: err }
  }

  if (typeof obj.departureDate !== 'string') {
    const err: ParseError = { message: 'Field "departureDate" must be a string', field: 'departureDate', raw }
    console.error('[fare-parser] parse error', err)
    return { ok: false, error: err }
  }

  if (!VALID_CABIN_CLASSES.includes(obj.cabinClass as typeof VALID_CABIN_CLASSES[number])) {
    const err: ParseError = {
      message: `Field "cabinClass" must be one of: ${VALID_CABIN_CLASSES.join(', ')}`,
      field: 'cabinClass',
      raw,
    }
    console.error('[fare-parser] parse error', err)
    return { ok: false, error: err }
  }

  if (typeof obj.priceUsd !== 'number') {
    const err: ParseError = { message: 'Field "priceUsd" must be a number', field: 'priceUsd', raw }
    console.error('[fare-parser] parse error', err)
    return { ok: false, error: err }
  }

  if (obj.priceUsd <= 0) {
    const err: ParseError = { message: 'Field "priceUsd" must be positive', field: 'priceUsd', raw }
    console.error('[fare-parser] parse error', err)
    return { ok: false, error: err }
  }

  if (Math.round(obj.priceUsd * 100) !== obj.priceUsd * 100) {
    const err: ParseError = {
      message: 'Field "priceUsd" must have at most 2 decimal places',
      field: 'priceUsd',
      raw,
    }
    console.error('[fare-parser] parse error', err)
    return { ok: false, error: err }
  }

  if (typeof obj.currency !== 'string') {
    const err: ParseError = { message: 'Field "currency" must be a string', field: 'currency', raw }
    console.error('[fare-parser] parse error', err)
    return { ok: false, error: err }
  }

  if (typeof obj.dataTimestamp !== 'string') {
    const err: ParseError = { message: 'Field "dataTimestamp" must be a string', field: 'dataTimestamp', raw }
    console.error('[fare-parser] parse error', err)
    return { ok: false, error: err }
  }

  if (typeof obj.offerId !== 'string') {
    const err: ParseError = { message: 'Field "offerId" must be a string', field: 'offerId', raw }
    console.error('[fare-parser] parse error', err)
    return { ok: false, error: err }
  }

  const fare: Fare = {
    route: obj.route,
    departureDate: obj.departureDate,
    cabinClass: obj.cabinClass as Fare['cabinClass'],
    priceUsd: obj.priceUsd,
    currency: obj.currency,
    dataTimestamp: obj.dataTimestamp,
    offerId: obj.offerId,
  }

  return { ok: true, value: fare }
}

export function serializeFare(fare: Fare): string {
  return JSON.stringify(fare)
}

export function deserializeFare(json: string): Result<Fare, ParseError> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    const err: ParseError = { message: `Invalid JSON: ${(e as Error).message}`, raw: json }
    console.error('[fare-parser] deserialize error', err)
    return { ok: false, error: err }
  }
  return parseFare(parsed)
}
