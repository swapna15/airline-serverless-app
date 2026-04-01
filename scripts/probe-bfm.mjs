import { readFileSync } from 'fs'
const env = readFileSync('.env.local', 'utf8')
for (const l of env.split('\n')) {
  const [k, ...v] = l.split('=')
  if (k && v.length) process.env[k.trim()] = v.join('=').trim()
}

const u = process.env.SABRE_USERNAME
const p = process.env.SABRE_PASSWORD
const e1 = Buffer.from(u).toString('base64')
const e2 = Buffer.from(p).toString('base64')
const c = Buffer.from(`${e1}:${e2}`).toString('base64')

const tr = await fetch('https://api.cert.platform.sabre.com/v2/auth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${c}` },
  body: 'grant_type=client_credentials',
})
const td = await tr.json()
const token = td.access_token
console.log('Token:', token?.slice(0, 40) + '...')

// Try the v1 endpoint with the correct request body
const body = {
  OTA_AirLowFareSearchRQ: {
    Version: '4',
    POS: { Source: [{ PseudoCityCode: 'DEVCENTER' }] },
    OriginDestinationInformation: [
      {
        RPH: '1',
        DepartureDateTime: { date: '2026-06-01', time: '00:00' },
        OriginLocation: { LocationCode: 'ORD' },
        DestinationLocation: { LocationCode: 'JFK' },
      },
    ],
    TravelerInfoSummary: {
      SeatsRequested: [1],
      AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }],
    },
    TravelPreferences: { MaxStopsQuantity: 2, CurrencyCode: 'USD' },
    TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '200ITINS' } } },
  },
}

const r = await fetch('https://api.cert.platform.sabre.com/v1/shop/flights?mode=live', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify(body),
})

const text = await r.text()
console.log('HTTP', r.status)
console.log(text.slice(0, 1000))
