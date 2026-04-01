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
console.log('Token:', token ? 'OK' : 'FAILED')

// Test a few simple endpoints
const tests = [
  '/v1/lists/utilities/geoservices/autocomplete?query=Chicago&category=AIR',
  '/v1/lists/supported/shop/flights/origins-destinations',
]

for (const path of tests) {
  const r = await fetch(`https://api.cert.platform.sabre.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const text = await r.text()
  console.log(`\n${path}`)
  console.log(`HTTP ${r.status}: ${text.slice(0, 200)}`)
}
