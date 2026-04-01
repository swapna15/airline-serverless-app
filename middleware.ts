import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getRateLimit } from './lib/rate-limit'

// Module-level rate limit store: key → { count, windowStart }
const rateLimitStore = new Map<string, { count: number; windowStart: number }>()

const WINDOW_MS = 60_000 // 60 seconds

export async function middleware(request: NextRequest) {
  // Only apply to /api/* routes
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Extract userId from the Next-Auth session token cookie (Edge-compatible — no DB call)
  // next-auth v5 uses 'authjs.session-token' in dev and '__Secure-authjs.session-token' in prod
  const sessionCookie =
    request.cookies.get('authjs.session-token')?.value ??
    request.cookies.get('__Secure-authjs.session-token')?.value

  // Decode the JWT payload without verification (we just need the userId for rate limiting)
  let userId: string | undefined
  if (sessionCookie) {
    try {
      const payload = sessionCookie.split('.')[1]
      if (payload) {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString())
        userId = decoded?.id ?? decoded?.sub
      }
    } catch {
      // malformed token — treat as unauthenticated
    }
  }

  // Key: userId for authenticated, IP for unauthenticated
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  const key = userId ? `user:${userId}` : `ip:${ip}`

  const now = Date.now()
  const limit = getRateLimit()

  const result = checkRateLimit(key, rateLimitStore, limit, WINDOW_MS, now)

  if (!result.allowed) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': String(result.retryAfter) },
    })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
