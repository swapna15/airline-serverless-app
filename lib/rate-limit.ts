const DEFAULT_LIMIT = 60

export function getRateLimit(): number {
  const val = parseInt(process.env.RATE_LIMIT_RPM ?? '', 10)
  return isNaN(val) ? DEFAULT_LIMIT : val
}

/**
 * Core sliding-window rate limit logic, extracted for testability.
 * Returns { allowed: true } when the request is within the limit,
 * or { allowed: false, retryAfter } (seconds) when the limit is exceeded.
 */
export function checkRateLimit(
  key: string,
  store: Map<string, { count: number; windowStart: number }>,
  limit: number,
  windowMs: number,
  now: number
): { allowed: boolean; retryAfter?: number } {
  const entry = store.get(key)

  if (!entry || now - entry.windowStart >= windowMs) {
    // Start a new window
    store.set(key, { count: 1, windowStart: now })
    return { allowed: true }
  }

  if (entry.count >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - entry.windowStart)) / 1000)
    return { allowed: false, retryAfter }
  }

  entry.count++
  return { allowed: true }
}
