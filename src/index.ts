/**
 * NanoVault - A lightweight Bitwarden-compatible server
 * 
 * Main entry point - routes requests to API modules.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Bindings } from './types'

// API Modules
import auth from './api/auth'
import sync from './api/sync'
import ciphers from './api/ciphers'
import folders from './api/folders'
import config from './api/config'

const app = new Hono<{ Bindings: Bindings }>()

// CORS middleware
app.use('*', cors())

// Mount API modules (all modules define full paths internally)
app.route('/', auth)
app.route('/', sync)
app.route('/', ciphers)
app.route('/', folders)
app.route('/', config)

// Health check
app.get('/health', (c) => c.json({ status: 'ok', version: '2.0.0' }))

export default app