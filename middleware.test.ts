import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { checkRateLimit, getRateLimit } from './lib/rate-limit'

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('checkRateLimit', () => {
  it('allows the first request in a new window', () => {
    const store = new Map<string, { count: number; windowStart: number }>()
    const result = checkRateLimit('user:abc', store, 60, 60_000, Date.now())
    expect(result.allowed).toBe(true)
  })

  it('allows requests up to the limit', () => {
    const store = new Map<string, { count: number; windowStart: number }>()
    const now = Date.now()
    for (let i = 0; i < 60; i++) {
      const result = checkRateLimit('user:abc', store, 60, 60_000, now)
      expect(result.allowed).toBe(true)
    }
  })

  it('blocks the request that exceeds the limit', () => {
    const store = new Map<string, { count: number; windowStart: number }>()
    const now = Date.now()
    for (let i = 0; i < 60; i++) {
      checkRateLimit('user:abc', store, 60, 60_000, now)
    }
    const result = checkRateLimit('user:abc', store, 60, 60_000, now)
    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBeGreaterThan(0)
  })

  it('resets the window after windowMs has elapsed', () => {
    const store = new Map<string, { count: number; windowStart: number }>()
    const now = Date.now()
    for (let i = 0; i < 60; i++) {
      checkRateLimit('user:abc', store, 60, 60_000, now)
    }
    // Advance time past the window
    const later = now + 60_001
    const result = checkRateLimit('user:abc', store, 60, 60_000, later)
    expect(result.allowed).toBe(true)
  })

  it('tracks different keys independently', () => {
    const store = new Map<string, { count: number; windowStart: number }>()
    const now = Date.now()
    for (let i = 0; i < 60; i++) {
      checkRateLimit('user:alice', store, 60, 60_000, now)
    }
    // alice is at limit, bob should still be allowed
    expect(checkRateLimit('user:alice', store, 60, 60_000, now).allowed).toBe(false)
    expect(checkRateLimit('user:bob', store, 60, 60_000, now).allowed).toBe(true)
  })
})

describe('getRateLimit', () => {
  it('returns 60 when RATE_LIMIT_RPM is not set', () => {
    const original = process.env.RATE_LIMIT_RPM
    delete process.env.RATE_LIMIT_RPM
    expect(getRateLimit()).toBe(60)
    if (original !== undefined) process.env.RATE_LIMIT_RPM = original
  })

  it('returns the configured value when RATE_LIMIT_RPM is set', () => {
    const original = process.env.RATE_LIMIT_RPM
    process.env.RATE_LIMIT_RPM = '120'
    expect(getRateLimit()).toBe(120)
    if (original !== undefined) process.env.RATE_LIMIT_RPM = original
    else delete process.env.RATE_LIMIT_RPM
  })

  it('returns 60 when RATE_LIMIT_RPM is not a valid number', () => {
    const original = process.env.RATE_LIMIT_RPM
    process.env.RATE_LIMIT_RPM = 'not-a-number'
    expect(getRateLimit()).toBe(60)
    if (original !== undefined) process.env.RATE_LIMIT_RPM = original
    else delete process.env.RATE_LIMIT_RPM
  })
})

// ─── Property 36: Rate limit 429 with Retry-After ────────────────────────────
// Feature: realtime-flight-rebooking, Property 36: Rate limit 429 with Retry-After
// Validates: Requirements 14.1, 14.2, 14.3
// When requests exceed the limit, response is 429 with Retry-After header
// containing a positive integer.

describe('Property 36: Rate limit 429 with Retry-After', () => {
  it('returns allowed=false with a positive integer retryAfter when limit is exceeded', () => {
    fc.assert(
      fc.property(
        // limit: 1..100, windowMs: 1000..120000, key: non-empty string
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1000, max: 120_000 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        (limit, windowMs, key) => {
          const store = new Map<string, { count: number; windowStart: number }>()
          const now = Date.now()

          // Exhaust the limit
          for (let i = 0; i < limit; i++) {
            checkRateLimit(key, store, limit, windowMs, now)
          }

          // The next request must be blocked
          const result = checkRateLimit(key, store, limit, windowMs, now)
          expect(result.allowed).toBe(false)
          expect(result.retryAfter).toBeDefined()
          expect(Number.isInteger(result.retryAfter)).toBe(true)
          expect(result.retryAfter!).toBeGreaterThan(0)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ─── Property 37: Rate limit default threshold ───────────────────────────────
// Feature: realtime-flight-rebooking, Property 37: Rate limit default threshold
// Validates: Requirements 14.4, 14.5
// When RATE_LIMIT_RPM env var is absent, effective limit is 60 rpm.

describe('Property 37: Rate limit default threshold', () => {
  it('allows exactly 60 requests and blocks the 61st when no env var is set', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 32 }),
        (key) => {
          const originalEnv = process.env.RATE_LIMIT_RPM
          delete process.env.RATE_LIMIT_RPM

          const limit = getRateLimit()
          expect(limit).toBe(60)

          const store = new Map<string, { count: number; windowStart: number }>()
          const now = Date.now()

          // All 60 requests should be allowed
          for (let i = 0; i < 60; i++) {
            const r = checkRateLimit(key, store, limit, 60_000, now)
            expect(r.allowed).toBe(true)
          }

          // The 61st must be blocked
          const blocked = checkRateLimit(key, store, limit, 60_000, now)
          expect(blocked.allowed).toBe(false)

          // Restore env
          if (originalEnv !== undefined) process.env.RATE_LIMIT_RPM = originalEnv
        }
      ),
      { numRuns: 100 }
    )
  })
})
