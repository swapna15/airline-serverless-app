import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { parseFare, serializeFare, deserializeFare, type Fare } from './fare-parser'

// ─── Arbitrary ────────────────────────────────────────────────────────────────

const MIN_DATE = new Date('2020-01-01').getTime()
const MAX_DATE = new Date('2035-12-31').getTime()

const arbitraryFare = () => fc.record({
  route: fc.tuple(
    fc.stringMatching(/^[A-Z]{3}$/),
    fc.stringMatching(/^[A-Z]{3}$/)
  ).map(([a, b]) => `${a}#${b}`),
  departureDate: fc.date({ min: new Date('2025-01-01'), max: new Date('2030-12-31') })
    .filter(d => !isNaN(d.getTime()))
    .map(d => d.toISOString().slice(0, 10)),
  cabinClass: fc.constantFrom('ECONOMY' as const, 'PREMIUM_ECONOMY' as const, 'BUSINESS' as const, 'FIRST' as const),
  // Generate price as integer cents then divide; filter to only values that satisfy
  // Math.round(priceUsd * 100) === priceUsd * 100 (floating-point safe)
  priceUsd: fc.integer({ min: 1, max: 1000000 })
    .map(n => n / 100)
    .filter(v => Math.round(v * 100) === v * 100),
  currency: fc.constant('USD'),
  dataTimestamp: fc.integer({ min: MIN_DATE, max: MAX_DATE })
    .map(ts => new Date(ts).toISOString()),
  offerId: fc.uuid(),
})

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('parseFare', () => {
  it('parses a valid fare object', () => {
    const raw = {
      route: 'ORD#JFK',
      departureDate: '2025-06-01',
      cabinClass: 'ECONOMY',
      priceUsd: 199.99,
      currency: 'USD',
      dataTimestamp: '2025-01-01T00:00:00.000Z',
      offerId: 'offer-123',
    }
    const result = parseFare(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.route).toBe('ORD#JFK')
      expect(result.value.priceUsd).toBe(199.99)
    }
  })

  it('rejects null input', () => {
    const result = parseFare(null)
    expect(result.ok).toBe(false)
  })

  it('rejects non-object input', () => {
    expect(parseFare('string').ok).toBe(false)
    expect(parseFare(42).ok).toBe(false)
    expect(parseFare([]).ok).toBe(false)
  })

  it('rejects missing required fields', () => {
    const base = {
      route: 'ORD#JFK',
      departureDate: '2025-06-01',
      cabinClass: 'ECONOMY',
      priceUsd: 100,
      currency: 'USD',
      dataTimestamp: '2025-01-01T00:00:00.000Z',
      offerId: 'offer-123',
    }
    for (const field of Object.keys(base)) {
      const partial = { ...base, [field]: undefined }
      const result = parseFare(partial)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.field).toBe(field)
      }
    }
  })

  it('rejects invalid cabinClass', () => {
    const result = parseFare({
      route: 'ORD#JFK',
      departureDate: '2025-06-01',
      cabinClass: 'INVALID',
      priceUsd: 100,
      currency: 'USD',
      dataTimestamp: '2025-01-01T00:00:00.000Z',
      offerId: 'offer-123',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.field).toBe('cabinClass')
  })

  it('rejects priceUsd <= 0', () => {
    const result = parseFare({
      route: 'ORD#JFK',
      departureDate: '2025-06-01',
      cabinClass: 'ECONOMY',
      priceUsd: 0,
      currency: 'USD',
      dataTimestamp: '2025-01-01T00:00:00.000Z',
      offerId: 'offer-123',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.field).toBe('priceUsd')
  })

  it('rejects priceUsd with more than 2 decimal places', () => {
    const result = parseFare({
      route: 'ORD#JFK',
      departureDate: '2025-06-01',
      cabinClass: 'ECONOMY',
      priceUsd: 100.123,
      currency: 'USD',
      dataTimestamp: '2025-01-01T00:00:00.000Z',
      offerId: 'offer-123',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.field).toBe('priceUsd')
  })

  it('accepts all valid cabin classes', () => {
    for (const cabinClass of ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']) {
      const result = parseFare({
        route: 'ORD#JFK',
        departureDate: '2025-06-01',
        cabinClass,
        priceUsd: 100,
        currency: 'USD',
        dataTimestamp: '2025-01-01T00:00:00.000Z',
        offerId: 'offer-123',
      })
      expect(result.ok).toBe(true)
    }
  })
})

describe('deserializeFare', () => {
  it('returns error on invalid JSON', () => {
    const result = deserializeFare('not-json{')
    expect(result.ok).toBe(false)
  })

  it('parses valid JSON fare', () => {
    const fare: Fare = {
      route: 'ORD#JFK',
      departureDate: '2025-06-01',
      cabinClass: 'BUSINESS',
      priceUsd: 500,
      currency: 'USD',
      dataTimestamp: '2025-01-01T00:00:00.000Z',
      offerId: 'offer-abc',
    }
    const result = deserializeFare(serializeFare(fare))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(fare)
  })
})

// ─── Property 22: Fare round-trip serialization ───────────────────────────────
// Feature: realtime-flight-rebooking, Property 22: Fare round-trip serialization
// Validates: Requirements 8.3, 8.4

describe('Property 22: Fare round-trip serialization', () => {
  it('serializeFare then deserializeFare produces an equivalent Fare', () => {
    fc.assert(
      fc.property(arbitraryFare(), (fare) => {
        const serialized = serializeFare(fare)
        const result = deserializeFare(serialized)
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value).toEqual(fare)
        }
      }),
      { numRuns: 100 }
    )
  })
})

// ─── Property 23: Fare price validation ──────────────────────────────────────
// Feature: realtime-flight-rebooking, Property 23: Fare price validation
// Validates: Requirements 8.5

describe('Property 23: Fare price validation', () => {
  it('all parsed Fares have priceUsd > 0 and at most 2 decimal places', () => {
    fc.assert(
      fc.property(arbitraryFare(), (fare) => {
        const result = parseFare(fare)
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.priceUsd).toBeGreaterThan(0)
          expect(Math.round(result.value.priceUsd * 100)).toBe(result.value.priceUsd * 100)
        }
      }),
      { numRuns: 100 }
    )
  })
})
