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
 * Validates both JWT signature and that the token's security stamp
 * matches the user's current stamp (invalidating tokens after password change).
 * Usage: app.use('*', createJwtMiddleware)
 */
export const createJwtMiddleware: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
    // First, validate JWT signature
    await jwt({ secret: getSecret(c.env) })(c, async () => { })

    // Then verify security stamp matches current user
    const payload = c.get('jwtPayload')
    if (!payload || !payload.email) {
        return c.json({ error: 'invalid_token', error_description: 'Invalid token payload' }, 401)
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
