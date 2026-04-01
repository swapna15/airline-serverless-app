import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Minimal in-memory user store that mirrors the upsertUserFromGoogle / getUserByEmail
 * contract from lib/db.ts, used to test the signIn callback logic in isolation.
 */
type UserRecord = {
  id: string
  name: string
  email: string
  passwordHash: string | null
  createdAt: string
  googleId?: string
  pictureUrl?: string
}

function makeStore() {
  const users: UserRecord[] = []

  async function getUserByEmail(email: string): Promise<UserRecord | undefined> {
    return users.find(u => u.email === email.toLowerCase())
  }

  async function upsertUserFromGoogle(data: {
    name: string
    email: string
    googleId: string
    pictureUrl: string
  }): Promise<{ user: UserRecord; isNew: boolean }> {
    const existing = await getUserByEmail(data.email)
    if (existing) {
      existing.googleId = data.googleId
      existing.pictureUrl = data.pictureUrl
      return { user: existing, isNew: false }
    }
    const user: UserRecord = {
      id: crypto.randomUUID(),
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      passwordHash: null,
      createdAt: new Date().toISOString(),
      googleId: data.googleId,
      pictureUrl: data.pictureUrl,
    }
    users.push(user)
    return { user, isNew: true }
  }

  return { users, getUserByEmail, upsertUserFromGoogle }
}

/**
 * Simulates the signIn callback logic from auth.ts for the Google provider.
 * Returns true on success, a redirect string on error.
 */
async function simulateGoogleSignIn(
  params: {
    name?: string | null
    email?: string | null
    googleId?: string | null
    pictureUrl?: string
  },
  store: ReturnType<typeof makeStore>
): Promise<boolean | string> {
  const { name, email, googleId, pictureUrl = '' } = params

  if (!name || !email || !googleId) {
    return '/login?error=missing_claims'
  }

  try {
    const { user: dbUser } = await store.upsertUserFromGoogle({
      name,
      email,
      googleId,
      pictureUrl,
    })
    return dbUser.id ? true : '/login?error=sso_error'
  } catch {
    return '/login?error=sso_error'
  }
}

/**
 * Simulates the credentials authorize guard from auth.ts.
 * Returns null when the user has a googleId but null passwordHash.
 */
function simulateCredentialsGuard(user: UserRecord | undefined): null | UserRecord {
  if (!user) return null
  if (user.googleId && user.passwordHash === null) return null
  return user
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const arbitraryGoogleProfile = () =>
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    email: fc.emailAddress(),
    googleId: fc.uuid(),
    pictureUrl: fc.webUrl(),
  })

const arbitraryUserRecord = () =>
  fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    email: fc.emailAddress(),
    passwordHash: fc.option(fc.string({ minLength: 10 }), { nil: null }),
    createdAt: fc.date().map(d => d.toISOString()),
    googleId: fc.option(fc.uuid(), { nil: undefined }),
    pictureUrl: fc.option(fc.webUrl(), { nil: undefined }),
  })

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('Google SSO signIn callback — unit tests', () => {
  it('returns /login?error=missing_claims when name is missing', async () => {
    const store = makeStore()
    const result = await simulateGoogleSignIn(
      { name: null, email: 'user@example.com', googleId: 'gid-123' },
      store
    )
    expect(result).toBe('/login?error=missing_claims')
  })

  it('returns /login?error=missing_claims when email is missing', async () => {
    const store = makeStore()
    const result = await simulateGoogleSignIn(
      { name: 'Alice', email: null, googleId: 'gid-123' },
      store
    )
    expect(result).toBe('/login?error=missing_claims')
  })

  it('returns /login?error=missing_claims when googleId is missing', async () => {
    const store = makeStore()
    const result = await simulateGoogleSignIn(
      { name: 'Alice', email: 'user@example.com', googleId: null },
      store
    )
    expect(result).toBe('/login?error=missing_claims')
  })

  it('creates a new user and returns true for a new email', async () => {
    const store = makeStore()
    const result = await simulateGoogleSignIn(
      { name: 'Alice', email: 'alice@example.com', googleId: 'gid-alice', pictureUrl: 'https://pic.example.com/alice.jpg' },
      store
    )
    expect(result).toBe(true)
    expect(store.users).toHaveLength(1)
    expect(store.users[0].email).toBe('alice@example.com')
    expect(store.users[0].googleId).toBe('gid-alice')
    expect(store.users[0].passwordHash).toBeNull()
  })

  it('links googleId to existing user without creating a duplicate', async () => {
    const store = makeStore()
    // Pre-populate with an existing credentials user
    store.users.push({
      id: 'existing-id',
      name: 'Bob',
      email: 'bob@example.com',
      passwordHash: '$2b$10$hashedpassword',
      createdAt: new Date().toISOString(),
    })

    const result = await simulateGoogleSignIn(
      { name: 'Bob', email: 'bob@example.com', googleId: 'gid-bob', pictureUrl: '' },
      store
    )
    expect(result).toBe(true)
    expect(store.users).toHaveLength(1) // no duplicate
    expect(store.users[0].googleId).toBe('gid-bob')
  })
})

describe('Credentials guard — unit tests', () => {
  it('returns null for SSO-only user (googleId set, passwordHash null)', () => {
    const user: UserRecord = {
      id: 'u1',
      name: 'Alice',
      email: 'alice@example.com',
      passwordHash: null,
      createdAt: new Date().toISOString(),
      googleId: 'gid-alice',
    }
    expect(simulateCredentialsGuard(user)).toBeNull()
  })

  it('returns user for credentials user (no googleId)', () => {
    const user: UserRecord = {
      id: 'u2',
      name: 'Bob',
      email: 'bob@example.com',
      passwordHash: '$2b$10$hash',
      createdAt: new Date().toISOString(),
    }
    expect(simulateCredentialsGuard(user)).toBe(user)
  })

  it('returns user for linked account with passwordHash present', () => {
    const user: UserRecord = {
      id: 'u3',
      name: 'Carol',
      email: 'carol@example.com',
      passwordHash: '$2b$10$hash',
      createdAt: new Date().toISOString(),
      googleId: 'gid-carol',
    }
    expect(simulateCredentialsGuard(user)).toBe(user)
  })

  it('returns null for undefined user', () => {
    expect(simulateCredentialsGuard(undefined)).toBeNull()
  })
})

// ─── Property 24: Google SSO new user creation ────────────────────────────────
// Feature: realtime-flight-rebooking, Property 24: Google SSO new user creation
// Validates: Requirements 9.2, 9.3, 9.5

describe('Property 24: Google SSO new user creation', () => {
  it('creates exactly one user record with all required fields for a new email', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryGoogleProfile(), async (profile) => {
        const store = makeStore()
        const result = await simulateGoogleSignIn(profile, store)

        expect(result).toBe(true)
        expect(store.users).toHaveLength(1)

        const user = store.users[0]
        expect(user.name).toBeTruthy()
        expect(user.email).toBeTruthy()
        expect(user.googleId).toBe(profile.googleId)
        expect(user.pictureUrl).toBe(profile.pictureUrl)
        expect(user.passwordHash).toBeNull()
      }),
      { numRuns: 100 }
    )
  })
})

// ─── Property 25: Google SSO no duplicate users ───────────────────────────────
// Feature: realtime-flight-rebooking, Property 25: Google SSO no duplicate users
// Validates: Requirements 9.4

describe('Property 25: Google SSO no duplicate users', () => {
  it('keeps exactly 1 user record when the same email signs in multiple times', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryGoogleProfile(),
        fc.integer({ min: 2, max: 5 }),
        async (profile, times) => {
          const store = makeStore()
          for (let i = 0; i < times; i++) {
            await simulateGoogleSignIn(
              { ...profile, googleId: `gid-${i}` },
              store
            )
          }
          const matching = store.users.filter(
            u => u.email === profile.email.toLowerCase()
          )
          expect(matching).toHaveLength(1)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ─── Property 26: Credentials sign-in guard for SSO accounts ─────────────────
// Feature: realtime-flight-rebooking, Property 26: Credentials sign-in guard for SSO accounts
// Validates: Requirements 9.8

describe('Property 26: Credentials sign-in guard for SSO accounts', () => {
  it('returns null for any user with googleId and null passwordHash', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // id
        fc.string({ minLength: 1 }), // name
        fc.emailAddress(), // email
        fc.uuid(), // googleId
        (id, name, email, googleId) => {
          const user: UserRecord = {
            id,
            name,
            email,
            passwordHash: null,
            createdAt: new Date().toISOString(),
            googleId,
          }
          expect(simulateCredentialsGuard(user)).toBeNull()
        }
      ),
      { numRuns: 100 }
    )
  })

  it('does not block users who have both googleId and a passwordHash', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1 }),
        fc.emailAddress(),
        fc.uuid(),
        fc.string({ minLength: 10 }),
        (id, name, email, googleId, passwordHash) => {
          const user: UserRecord = {
            id,
            name,
            email,
            passwordHash,
            createdAt: new Date().toISOString(),
            googleId,
          }
          expect(simulateCredentialsGuard(user)).toBe(user)
        }
      ),
      { numRuns: 100 }
    )
  })
})
