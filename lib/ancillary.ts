import { randomUUID } from 'crypto'
import { getBookingById, docClient } from './db'
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Booking } from './types'

export type AncillaryType = 'seat_upgrade' | 'baggage' | 'lounge' | 'hotel' | 'ground_transport'

export interface AncillaryOption {
  type: AncillaryType
  name: string
  price: number
  provider: string
  metadata?: Record<string, unknown>
}

export interface Bundle {
  id: string
  components: AncillaryOption[]
  individualTotal: number
  bundlePrice: number  // always <= individualTotal
}

/**
 * Build a bundle from a list of ancillary options.
 * bundlePrice = individualTotal * 0.9 (10% bundle discount), rounded to 2 decimal places.
 * bundlePrice is always <= individualTotal.
 */
export function buildBundle(items: AncillaryOption[]): Bundle {
  const individualTotal = items.reduce((sum, item) => sum + item.price, 0)
  const bundlePrice = Math.round(individualTotal * 0.9 * 100) / 100

  return {
    id: randomUUID(),
    components: items,
    individualTotal,
    bundlePrice,
  }
}

const bookingsTable = process.env.DDB_BOOKINGS_TABLE || 'airline-bookings'

/**
 * Add an ancillary item to a booking.
 * Returns error if departure is <= 24 hours away.
 * Returns error if bookingId is not found.
 * On success: updates the booking's ancillaries array in DynamoDB and returns the updated booking.
 */
export async function addAncillaryToBooking(
  bookingId: string,
  item: AncillaryOption,
  departureTime: Date
): Promise<{ booking?: Booking; error?: string }> {
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000)
  if (departureTime <= cutoff) {
    return { error: 'Cannot add ancillaries within 24 hours of departure' }
  }

  const existing = await getBookingById(bookingId)
  if (!existing) {
    return { error: `Booking not found: ${bookingId}` }
  }

  const ancillaryItem = {
    type: item.type,
    name: item.name,
    price: item.price,
    addedAt: new Date().toISOString(),
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: bookingsTable,
      Key: { id: bookingId },
      ConditionExpression: 'attribute_exists(id)',
      UpdateExpression:
        'SET ancillaries = list_append(if_not_exists(ancillaries, :empty), :items)',
      ExpressionAttributeValues: {
        ':empty': [],
        ':items': [ancillaryItem],
      },
      ReturnValues: 'ALL_NEW',
    })
  )

  const updated = result.Attributes as Booking
  return { booking: updated }
}
