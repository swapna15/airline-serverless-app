import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { buildBundle, addAncillaryToBooking, type AncillaryOption } from './ancillary'

// ─── Arbitrary ────────────────────────────────────────────────────────────────

const ancillaryTypes = ['seat_upgrade', 'baggage', 'lounge', 'hotel', 'ground_transport'] as const

const arbitraryAncillaryOption = () =>
  fc.record({
    type: fc.constantFrom(...ancillaryTypes),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    // Use integer cents to avoid floating-point precision issues
    price: fc.integer({ min: 1, max: 100000 }).map(n => n / 100),
    provider: fc.string({ minLength: 1, maxLength: 30 }),
  })

const arbitraryAncillaryList = () =>
  fc.array(arbitraryAncillaryOption(), { minLength: 1, maxLength: 10 })

// ─── Unit tests for buildBundle ───────────────────────────────────────────────

describe('buildBundle', () => {
  it('returns a bundle with a UUID id', () => {
    const items: AncillaryOption[] = [
      { type: 'baggage', name: 'Extra bag', price: 30, provider: 'Airline' },
    ]
    const bundle = buildBundle(items)
    expect(bundle.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('calculates individualTotal as sum of item prices', () => {
    const items: AncillaryOption[] = [
      { type: 'baggage', name: 'Extra bag', price: 30, provider: 'Airline' },
      { type: 'lounge', name: 'Lounge access', price: 50, provider: 'Airport' },
    ]
    const bundle = buildBundle(items)
    expect(bundle.individualTotal).toBe(80)
  })

  it('applies 10% discount for bundlePrice', () => {
    const items: AncillaryOption[] = [
      { type: 'baggage', name: 'Extra bag', price: 100, provider: 'Airline' },
    ]
    const bundle = buildBundle(items)
    expect(bundle.bundlePrice).toBe(90)
  })

  it('rounds bundlePrice to 2 decimal places', () => {
    const items: AncillaryOption[] = [
      { type: 'baggage', name: 'Extra bag', price: 10.01, provider: 'Airline' },
    ]
    const bundle = buildBundle(items)
    // 10.01 * 0.9 = 9.009 → rounded to 9.01
    expect(bundle.bundlePrice).toBe(9.01)
  })

  it('includes all components in the bundle', () => {
    const items: AncillaryOption[] = [
      { type: 'seat_upgrade', name: 'Upgrade', price: 200, provider: 'Airline' },
      { type: 'hotel', name: 'Hotel night', price: 150, provider: 'HotelCo' },
    ]
    const bundle = buildBundle(items)
    expect(bundle.components).toEqual(items)
  })
})

// ─── Property 12: Bundle price invariant ─────────────────────────────────────
// Feature: realtime-flight-rebooking, Property 12: Bundle price invariant
// Validates: Requirements 5.2

describe('Property 12: Bundle price invariant', () => {
  it('bundlePrice is always <= individualTotal for any list of ancillary items', () => {
    fc.assert(
      fc.property(arbitraryAncillaryList(), (items) => {
        const bundle = buildBundle(items)
        expect(bundle.bundlePrice).toBeLessThanOrEqual(bundle.individualTotal)
      }),
      { numRuns: 100 }
    )
  })
})

// ─── Unit tests for addAncillaryToBooking time gate ───────────────────────────

describe('addAncillaryToBooking - time gate', () => {
  const item: AncillaryOption = {
    type: 'baggage',
    name: 'Extra bag',
    price: 30,
    provider: 'Airline',
  }

  it('returns error when departure is exactly 24h from now', async () => {
    const departure = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const result = await addAncillaryToBooking('BK-001', item, departure)
    expect(result.error).toBe('Cannot add ancillaries within 24 hours of departure')
    expect(result.booking).toBeUndefined()
  })

  it('returns error when departure is less than 24h from now', async () => {
    const departure = new Date(Date.now() + 12 * 60 * 60 * 1000)
    const result = await addAncillaryToBooking('BK-001', item, departure)
    expect(result.error).toBe('Cannot add ancillaries within 24 hours of departure')
  })

  it('returns error when departure is in the past', async () => {
    const departure = new Date(Date.now() - 1000)
    const result = await addAncillaryToBooking('BK-001', item, departure)
    expect(result.error).toBe('Cannot add ancillaries within 24 hours of departure')
  })
})

// ─── Property 14: Ancillary time gate ────────────────────────────────────────
// Feature: realtime-flight-rebooking, Property 14: Ancillary time gate
// Validates: Requirements 5.5

describe('Property 14: Ancillary time gate', () => {
  // We test the time gate logic in isolation by mocking getBookingById so that
  // when departure > 24h the mock returns a booking (success path), and when
  // departure <= 24h the error is returned before any DB call is made.

  beforeEach(() => {
    vi.resetModules()
  })

  it('fails when departure is <= 24h away, succeeds when > 24h away (mocked DB)', async () => {
    // Mock the db module so getBookingById returns a booking
    vi.mock('./db', () => ({
      getBookingById: vi.fn().mockResolvedValue({
        id: 'BK-TEST',
        flightId: 'FL-001',
        userId: 'user-1',
        passengers: [],
        status: 'confirmed',
        createdAt: new Date().toISOString(),
      }),
      docClient: {
        send: vi.fn().mockResolvedValue({
          Attributes: {
            id: 'BK-TEST',
            flightId: 'FL-001',
            userId: 'user-1',
            passengers: [],
            status: 'confirmed',
            createdAt: new Date().toISOString(),
            ancillaries: [{ type: 'baggage', name: 'Extra bag', price: 30, addedAt: new Date().toISOString() }],
          },
        }),
      },
    }))

    const { addAncillaryToBooking: addFn } = await import('./ancillary')

    const item: AncillaryOption = {
      type: 'baggage',
      name: 'Extra bag',
      price: 30,
      provider: 'Airline',
    }

    await fc.assert(
      fc.asyncProperty(
        // Generate hours offset: negative values and 0-24h = should fail; > 24h = should succeed
        fc.oneof(
          // <= 24h: should fail
          fc.integer({ min: -48, max: 0 }).map(h => ({
            hoursFromNow: h,
            shouldSucceed: false,
          })),
          // > 24h: should succeed (mocked DB)
          fc.integer({ min: 25, max: 720 }).map(h => ({
            hoursFromNow: h,
            shouldSucceed: true,
          }))
        ),
        async ({ hoursFromNow, shouldSucceed }) => {
          const departure = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
          const result = await addFn('BK-TEST', item, departure)

          if (shouldSucceed) {
            // With mocked DB, no error from time gate
            expect(result.error).toBeUndefined()
          } else {
            expect(result.error).toBe('Cannot add ancillaries within 24 hours of departure')
          }
        }
      ),
      { numRuns: 100 }
    )

    vi.restoreAllMocks()
  })
})
