/**
 * Authentication Utility Functions
 * 
 * Shared authentication helpers used across API modules.
 */

import { jwt } from 'hono/jwt'
import type { Bindings } from '../types'
import type { MiddlewareHandler } from 'hono'

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
 * Usage: app.use('*', createJwtMiddleware)
 */
export const createJwtMiddleware: MiddlewareHandler<{ Bindings: Bindings }> = (c, next) => {
    return jwt({ secret: getSecret(c.env) })(c, next)
}
