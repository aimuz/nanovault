/**
 * Authentication Utility Functions
 * 
 * Shared authentication helpers used across API modules.
 */

import { jwt } from 'hono/jwt'
import type { Bindings } from '../types'
import type { MiddlewareHandler } from 'hono'
import { getUser } from '../storage/kv'

const DEFAULT_SECRET = 'nanovault-secret-key-change-me'

/**
 * Returns the JWT secret from environment, falling back to a default.
 * The default should be changed in production.
 */
export function getSecret(env: Bindings): string {
    return env.JWT_SECRET || DEFAULT_SECRET
}

/**
 * Creates a JWT middleware handler for the given environment.
 * Validates:
 * 1. JWT signature
 * 2. Token type is 'access' (not 'refresh')
 * 3. Security stamp matches user's current stamp
 */
export const protected_: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
    // First, validate JWT signature
    await jwt({ secret: getSecret(c.env) })(c, async () => { })

    // Then verify payload
    const payload = c.get('jwtPayload')
    if (!payload || !payload.email) {
        return c.json({ error: 'invalid_token', error_description: 'Invalid token payload' }, 401)
    }

    // Verify this is an access token, not a refresh token
    if (payload.token_type !== 'access') {
        return c.json({ error: 'invalid_token', error_description: 'Invalid token type' }, 401)
    }

    const user = await getUser(c.env.DB, payload.email)
    if (!user) {
        return c.json({ error: 'invalid_token', error_description: 'User not found' }, 401)
    }

    // Verify security stamp - this invalidates tokens after password change
    if (payload.stamp !== user.securityStamp) {
        return c.json({ error: 'invalid_token', error_description: 'Token has been revoked' }, 401)
    }

    return next()
}
