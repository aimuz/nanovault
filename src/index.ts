/**
 * NanoVault - A lightweight Bitwarden-compatible server
 * 
 * Main entry point - centralized route registration.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Bindings } from './types'
import { registerRoutes } from './routes'

const app = new Hono<{ Bindings: Bindings }>()

// CORS middleware
app.use('*', cors())

// Register all routes
registerRoutes(app)

export default app  