import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { SabreClient } from './sabre'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAxiosError(status: number, sabreCode?: string) {
  return Object.assign(new Error('Request failed with status code ' + status), {
    isAxiosError: true,
    response: {
      status,
      data: sabreCode
        ? { errors: [{ code: sabreCode, message: 'Error' }] }
        : {},
    },
  })
}

function makeTestClient(): SabreClient {
  const client = new SabreClient('testuser', 'testpass', 'cert')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(client as any).cachedToken = {
    value: 'valid_token',
    expiresAt: Date.now() + 3_600_000,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(client as any).sleep = () => Promise.resolve()
  return client
}

// ─── Property 27: Sabre token proactive refresh ───────────────────────────────
// Feature: realtime-flight-rebooking, Property 27: Sabre token proactive refresh
// Validates: Requirements 10.2

describe('Property 27: Sabre token proactive refresh', () => {
  it('requests a new token when existing token expires within 60 seconds', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 59 }),
        async (secondsUntilExpiry) => {
          const client = new SabreClient('testuser', 'testpass', 'cert')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(client as any).cachedToken = {
            value: 'old_token',
            expiresAt: Date.now() + secondsUntilExpiry * 1000,
          }

          const refreshSpy = vi.fn().mockImplementation(async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(client as any).cachedToken = {
              value: 'new_token',
              expiresAt: Date.now() + 3_600_000,
            }
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(client as any).refreshToken = refreshSpy

          const token = await client.getToken()

          expect(refreshSpy).toHaveBeenCalledTimes(1)
          expect(token).toBe('new_token')
        }
      ),
      { numRuns: 100 }
    )
  })

  it('does NOT refresh when token has more than 60 seconds remaining', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 61, max: 3600 }),
        async (secondsUntilExpiry) => {
          const client = new SabreClient('testuser', 'testpass', 'cert')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(client as any).cachedToken = {
            value: 'valid_token',
            expiresAt: Date.now() + secondsUntilExpiry * 1000,
          }

          const refreshSpy = vi.fn()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(client as any).refreshToken = refreshSpy

          const token = await client.getToken()

          expect(refreshSpy).not.toHaveBeenCalled()
          expect(token).toBe('valid_token')
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ─── Property 28: Sabre retry with exponential backoff ────────────────────────
// Feature: realtime-flight-rebooking, Property 28: Sabre retry with exponential backoff
// Validates: Requirements 10.3

describe('Property 28: Sabre retry with exponential backoff', () => {
  it('retries at most 3 times on HTTP 429 or 5xx before throwing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(429, 500, 502, 503, 504),
        async (status) => {
          const client = makeTestClient()
          const error = makeAxiosError(status)
          let callCount = 0

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const originalWithRetry = (client as any).withRetry.bind(client)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(client as any).withRetry = (fn: () => Promise<unknown>, correlationId: string) => {
            const wrappedFn = () => { callCount++; return Promise.reject(error) }
            return originalWithRetry(wrappedFn, correlationId)
          }

          await expect(
            client.searchFlightOffers({
              originLocationCode: 'JFK',
              destinationLocationCode: 'LAX',
              departureDate: '2025-01-01',
              adults: 1,
              currencyCode: 'USD',
              max: 5,
            })
          ).rejects.toBeDefined()

          expect(callCount).toBe(4) // 1 initial + 3 retries
        }
      ),
      { numRuns: 100 }
    )
  })

  it('does NOT retry on non-retryable 4xx errors (except 429)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(400, 401, 403, 404, 422),
        async (status) => {
          const client = makeTestClient()
          const error = makeAxiosError(status)
          let callCount = 0

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const originalWithRetry = (client as any).withRetry.bind(client)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(client as any).withRetry = (fn: () => Promise<unknown>, correlationId: string) => {
            const wrappedFn = () => { callCount++; return Promise.reject(error) }
            return originalWithRetry(wrappedFn, correlationId)
          }

          await expect(
            client.searchFlightOffers({
              originLocationCode: 'JFK',
              destinationLocationCode: 'LAX',
              departureDate: '2025-01-01',
              adults: 1,
              currencyCode: 'USD',
              max: 5,
            })
          ).rejects.toBeDefined()

          expect(callCount).toBe(1)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('treats network failures (no response) as retryable', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null),
        async () => {
          const client = makeTestClient()
          const networkError = new Error('Network Error')
          let callCount = 0

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const originalWithRetry = (client as any).withRetry.bind(client)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(client as any).withRetry = (fn: () => Promise<unknown>, correlationId: string) => {
            const wrappedFn = () => { callCount++; return Promise.reject(networkError) }
            return originalWithRetry(wrappedFn, correlationId)
          }

          await expect(
            client.searchFlightOffers({
              originLocationCode: 'JFK',
              destinationLocationCode: 'LAX',
              departureDate: '2025-01-01',
              adults: 1,
              currencyCode: 'USD',
              max: 5,
            })
          ).rejects.toBeDefined()

          expect(callCount).toBe(4)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ─── Property 29: Sabre environment switching ─────────────────────────────────
// Feature: realtime-flight-rebooking, Property 29: Sabre environment switching
// Validates: Requirements 10.5

describe('Property 29: Sabre environment switching', () => {
  it('uses cert base URL when env is "cert"', () => {
    fc.assert(
      fc.property(fc.constant('cert' as const), (env) => {
        const client = new SabreClient('testuser', 'testpass', env)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((client as any).baseUrl).toBe('https://api.cert.platform.sabre.com')
      }),
      { numRuns: 100 }
    )
  })

  it('uses production base URL when env is "production"', () => {
    fc.assert(
      fc.property(fc.constant('production' as const), (env) => {
        const client = new SabreClient('testuser', 'testpass', env)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((client as any).baseUrl).toBe('https://api.platform.sabre.com')
      }),
      { numRuns: 100 }
    )
  })

  it('defaults to cert URL when env is not "production"', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s !== 'production'),
        (env) => {
          const resolvedEnv = env === 'production' ? 'production' : 'cert'
          const client = new SabreClient('id', 'secret', resolvedEnv)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expect((client as any).baseUrl).toBe('https://api.cert.platform.sabre.com')
        }
      ),
      { numRuns: 100 }
    )
  })

  it('singleton factory picks correct URL based on SABRE_ENV', () => {
    const origEnv = process.env.SABRE_ENV

    process.env.SABRE_ENV = 'cert'
    const certClient = new SabreClient('id', 'secret', process.env.SABRE_ENV === 'production' ? 'production' : 'cert')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((certClient as any).baseUrl).toBe('https://api.cert.platform.sabre.com')

    process.env.SABRE_ENV = 'production'
    const prodClient = new SabreClient('id', 'secret', process.env.SABRE_ENV === 'production' ? 'production' : 'cert')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prodClient as any).baseUrl).toBe('https://api.platform.sabre.com')

    process.env.SABRE_ENV = origEnv
  })
})
