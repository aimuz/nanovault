/**
 * NanoVault - Application Factory
 * 
 * Creates a platform-agnostic Hono application instance.
 * This is shared across different entry points (Cloudflare, Aliyun ESA, etc.)
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Bindings } from './types'
import { registerRoutes } from './routes'

/**
 * Creates a new Hono application with all routes registered.
 * The returned app can be used with any platform that supports the Fetch API.
 */
export function createApp(): Hono<{ Bindings: Bindings }> {
    const app = new Hono<{ Bindings: Bindings }>()

    // CORS middleware
    app.use('*', cors())

    // Register all routes
    registerRoutes(app)

    return app
}
