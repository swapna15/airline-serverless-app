/**
 * Sabre connectivity test script
 * Tests: 1) Token auth  2) BargainFinderMax flight search (probes multiple endpoint paths)
 * Run: node scripts/test-sabre-connectivity.mjs
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local manually
const envPath = resolve(process.cwd(), '.env.local')
const envContent = readFileSync(envPath, 'utf-8')
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const [key, ...rest] = trimmed.split('=')
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
}

const BASE_URL = process.env.SABRE_BASE_URL || 'https://api.cert.platform.sabre.com'
const USERNAME = process.env.SABRE_USERNAME
const PASSWORD = process.env.SABRE_PASSWORD
const PCC = process.env.SABRE_PCC || 'TEST'

console.log('─── Sabre Connectivity Test ─────────────────────────────')
console.log(`Base URL : ${BASE_URL}`)
console.log(`Username : ${USERNAME}`)
console.log(`PCC      : ${PCC}`)
console.log('─────────────────────────────────────────────────────────\n')

// ── Step 1: Get token ─────────────────────────────────────────────────────────

console.log('Step 1: Requesting access token...')

// Sabre triple base64 encoding:
// 1. base64(username)  — username already contains "V1:{EPR}:{PCC}:EXT"
// 2. base64(password)
// 3. base64("{step1}:{step2}")
const rawUserId = USERNAME.startsWith('V1:') ? USERNAME : `V1:${USERNAME}:${PCC}:AA`
const encodedClientId = Buffer.from(rawUserId).toString('base64')
const encodedPassword = Buffer.from(PASSWORD).toString('base64')
const combined = Buffer.from(`${encodedClientId}:${encodedPassword}`).toString('base64')

console.log(`  Encoding: base64("${rawUserId}") : base64(password)`)

let token
try {
  const tokenRes = await fetch(`${BASE_URL}/v2/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${combined}`,
    },
    body: 'grant_type=client_credentials',
  })

  const tokenBody = await tokenRes.text()

  if (!tokenRes.ok) {
    console.error(`✗ Token request failed: HTTP ${tokenRes.status}`)
    console.error('  Response:', tokenBody)
    process.exit(1)
  }

  const tokenData = JSON.parse(tokenBody)
  token = tokenData.access_token
  const expiresIn = tokenData.expires_in

  console.log(`✓ Token obtained (expires in ${expiresIn}s)`)
  console.log(`  Token preview: ${token?.slice(0, 40)}...\n`)
} catch (err) {
  console.error('✗ Token request threw an error:', err.message)
  process.exit(1)
}

// ── Step 2: Probe BargainFinderMax endpoint paths ────────────────────────────

console.log('Step 2: Probing BargainFinderMax endpoint paths...\n')

const searchBody = {
  OTA_AirLowFareSearchRQ: {
    Version: '4',
    POS: { Source: [{ PseudoCityCode: PCC }] },
    OriginDestinationInformation: [
      {
        RPH: '1',
        DepartureDateTime: '2026-06-01T00:00',
        OriginLocation: { LocationCode: 'ORD' },
        DestinationLocation: { LocationCode: 'JFK' },
      },
    ],
    TravelerInfoSummary: {
      SeatsRequested: [1],
      AirTravelerAvail: [
        { PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] },
      ],
    },
    TravelPreferences: { MaxStopsQuantity: 2, CurrencyCode: 'USD' },
    TPA_Extensions: {
      IntelliSellTransaction: { RequestType: { Name: '200ITINS' } },
    },
  },
}

const paths = [
  '/v1/shop/flights',
  '/v2/shop/flights',
  '/v3/shop/flights',
  '/v4/shop/flights',
  '/v4.0.0/shop/flights',
  '/v4.1.0/shop/flights',
  '/v4.2.0/shop/flights',
  '/v1/offers/shop/flights',
  '/v2/offers/shop/flights',
]

let foundPath = null

for (const path of paths) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(searchBody),
    })
    const text = await res.text()
    const preview = text.slice(0, 150).replace(/\n/g, ' ')
    const status = res.status
    const marker = status === 200 ? '✓' : status === 400 ? '~' : '✗'
    console.log(`  ${marker} ${path} → HTTP ${status} | ${preview}`)
    if (status === 200 && !foundPath) foundPath = path
  } catch (err) {
    console.log(`  ✗ ${path} → ERROR: ${err.message}`)
  }
}

console.log('\n─────────────────────────────────────────────────────────')
if (foundPath) {
  console.log(`✓ Sabre connectivity test PASSED`)
  console.log(`  Working endpoint: ${foundPath}`)
} else {
  console.log('✓ Token auth PASSED')
  console.log('~ Flight search endpoint not confirmed — check responses above')
  console.log('  HTTP 400 responses mean the endpoint exists but the request body needs adjustment')
  console.log('  HTTP 404 means the path does not exist')
}
console.log('─────────────────────────────────────────────────────────')
