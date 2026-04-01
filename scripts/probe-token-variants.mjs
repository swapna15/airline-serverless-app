/**
 * Tests different token encoding variants to find what gives the most access
 */
import { readFileSync } from 'fs'
const env = readFileSync('.env.local', 'utf8')
for (const l of env.split('\n')) {
  const [k, ...v] = l.split('=')
  if (k && v.length) process.env[k.trim()] = v.join('=').trim()
}

const BASE = 'https://api.cert.platform.sabre.com'
const USERNAME = process.env.SABRE_USERNAME  // V1:fy291wuqe6dhqy3i:DEVCENTER:EXT
const PASSWORD = process.env.SABRE_PASSWORD

console.log('Username:', USERNAME)
console.log('Password:', PASSWORD)
console.log()

// The username already has V1: prefix and :EXT suffix
// Try using it as-is vs replacing :EXT with :AA
const variants = [
  { label: 'As-is (V1:...:EXT)', userId: USERNAME },
  { label: 'Replace EXT with AA', userId: USERNAME.replace(':EXT', ':AA') },
  { label: 'Just EPR part with AA', userId: `V1:fy291wuqe6dhqy3i:DEVCENTER:AA` },
]

for (const { label, userId } of variants) {
  const e1 = Buffer.from(userId).toString('base64')
  const e2 = Buffer.from(PASSWORD).toString('base64')
  const combined = Buffer.from(`${e1}:${e2}`).toString('base64')

  const tr = await fetch(`${BASE}/v2/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${combined}`,
    },
    body: 'grant_type=client_credentials',
  })
  const data = await tr.json()
  const token = data.access_token

  console.log(`--- ${label} ---`)
  console.log(`userId: ${userId}`)
  console.log(`HTTP ${tr.status}: ${token ? 'Token OK (' + token.slice(0, 30) + '...)' : JSON.stringify(data)}`)

  if (token) {
    // Test flightShop with this token
    const r = await fetch(`${BASE}/v1/offers/flightShop/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        pointOfSale: { location: { countryCode: 'US', cityCode: 'ORD' }, agentDutyCode: '*' },
        journeys: [{
          departureLocation: { airportCode: 'ORD' },
          arrivalLocation: { airportCode: 'JFK' },
          departureDate: '2026-06-15',
        }],
        travelers: [{ id: '1', passengerTypeCode: 'ADT' }],
        cabin: 'ECONOMY',
        currency: 'USD',
      }),
    })
    const text = await r.text()
    console.log(`flightShop → HTTP ${r.status}: ${text.slice(0, 200)}`)
  }
  console.log()
}
