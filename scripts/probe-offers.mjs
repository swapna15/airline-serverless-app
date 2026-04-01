/**
 * Probes Sabre /v1/offers/flightShop/ and related modern endpoints
 */
import { readFileSync } from 'fs'
const env = readFileSync('.env.local', 'utf8')
for (const l of env.split('\n')) {
  const [k, ...v] = l.split('=')
  if (k && v.length) process.env[k.trim()] = v.join('=').trim()
}

const BASE = process.env.SABRE_BASE_URL || 'https://api.cert.platform.sabre.com'
const u = process.env.SABRE_USERNAME
const p = process.env.SABRE_PASSWORD
const e1 = Buffer.from(u).toString('base64')
const e2 = Buffer.from(p).toString('base64')
const c = Buffer.from(`${e1}:${e2}`).toString('base64')

const tr = await fetch(`${BASE}/v2/auth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${c}` },
  body: 'grant_type=client_credentials',
})
const token = (await tr.json()).access_token
console.log('Token:', token ? 'OK' : 'FAILED', '\n')

// Modern Offers API request body
const offersBody = {
  OTA_AirLowFareSearchRQ: {
    MaxResponses: '10',
    Version: '3',
    POS: {
      Source: [{
        PseudoCityCode: 'DEVCENTER',
        RequestorID: { CompanyName: { Code: 'TN' }, ID: '1', Type: '1' },
      }],
    },
    OriginDestinationInformation: [{
      RPH: '1',
      DepartureDateTime: '2026-06-01T00:00:00',
      OriginLocation: { LocationCode: 'ORD' },
      DestinationLocation: { LocationCode: 'JFK' },
      TPA_Extensions: { SegmentType: { Code: 'O' } },
    }],
    TravelerInfoSummary: {
      SeatsRequested: [1],
      AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }],
      PriceRequestInformation: { TPA_Extensions: {} },
    },
    TravelPreferences: {
      MaxStopsQuantity: 99,
      TPA_Extensions: {
        DataSources: { ATPCO: 'Enable', LCC: 'Disable', NDC: 'Disable' },
        NumTrips: { Number: 10 },
      },
    },
    TPA_Extensions: {
      IntelliSellTransaction: { RequestType: { Name: '200ITINS' } },
    },
  },
}

// Modern Offers API — completely different schema from OTA BFM
const flightShopBody = {
  pointOfSale: {
    location: { countryCode: 'US', cityCode: 'ORD' },
    agentDutyCode: '*',
  },
  journeys: [{
    departureLocation: { airportCode: 'ORD' },
    arrivalLocation: { airportCode: 'JFK' },
    departureDate: '2026-06-01',
  }],
  travelers: [{ id: '1', passengerTypeCode: 'ADT' }],
  cabin: 'ECONOMY',
  currency: 'USD',
}

const endpoints = [
  { method: 'POST', path: '/v1/offers/flightShop/', body: flightShopBody },
  { method: 'POST', path: '/v1/offers/flightShop', body: flightShopBody },
]

for (const { method, path, body } of endpoints) {
  try {
    const opts = {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    }
    if (body) opts.body = JSON.stringify(body)

    const r = await fetch(`${BASE}${path}`, opts)
    const text = await r.text()
    const preview = text.slice(0, 500).replace(/\n/g, ' ')
    const marker = r.status === 200 ? '✓' : r.status < 500 ? '~' : '✗'
    console.log(`${marker} ${method} ${path}`)
    console.log(`  HTTP ${r.status}: ${preview}\n`)
  } catch (err) {
    console.log(`✗ ${method} ${path}`)
    console.log(`  ERROR: ${err.message}\n`)
  }
}
