/**
 * Centralized Route Registration
 * 
 * All routes are defined here for easy overview.
 * Handlers are imported from api modules.
 */

import { Hono } from 'hono'
import type { Bindings } from './types'
import { protected_ } from './utils/auth'

// Import handlers from api modules
import * as auth from './api/auth'
import * as sync from './api/sync'
import * as ciphers from './api/ciphers'
import * as folders from './api/folders'
import * as config from './api/config'
import * as devices from './api/devices'

export const registerRoutes = (app: Hono<{ Bindings: Bindings }>) => {
    // ==========================================================================
    // Health Check
    // ==========================================================================
    app.get('/health', (c) => c.json({ status: 'ok', version: '2.0.0' }))

    // ==========================================================================
    // Auth - Prelogin
    // ==========================================================================
    app.post('/api/accounts/prelogin', auth.handlePrelogin)
    app.post('/identity/accounts/prelogin', auth.handlePrelogin)

    // ==========================================================================
    // Auth - Registration
    // ==========================================================================
    app.post('/api/accounts/register', auth.legacyRegisterHandler)
    app.post('/identity/accounts/register', auth.legacyRegisterHandler)
    app.post('/identity/accounts/register/finish', auth.handleRegisterFinish)
    app.post('/identity/accounts/register/send-verification-email', auth.handleSendVerificationEmail)

    // ==========================================================================
    // Auth - Email Change
    // ==========================================================================
    app.post('/api/accounts/email-token', protected_, auth.handleEmailToken)
    app.post('/api/accounts/email', protected_, auth.handleEmailChange)

    // ==========================================================================
    // Auth - Password
    // ==========================================================================
    app.post('/api/accounts/password', protected_, auth.handlePasswordChange)

    // ==========================================================================
    // Auth - Token
    // ==========================================================================
    app.post('/identity/connect/token', auth.handleToken)

    // ==========================================================================
    // Sync
    // ==========================================================================
    app.get('/api/accounts/profile', protected_, sync.handleProfile)
    app.get('/api/accounts/revision-date', protected_, sync.handleRevisionDate)
    app.get('/api/sync', protected_, sync.handleSync)

    // ==========================================================================
    // Ciphers
    // ==========================================================================
    app.post('/api/ciphers', protected_, ciphers.handleCreate)
    app.post('/api/ciphers/import', protected_, ciphers.handleImport)
    app.get('/api/ciphers/:id', protected_, ciphers.handleGet)
    app.put('/api/ciphers/:id', protected_, ciphers.handleUpdate)
    app.delete('/api/ciphers/:id', protected_, ciphers.handleDelete)
    app.put('/api/ciphers/:id/delete', protected_, ciphers.handleSoftDelete)
    app.put('/api/ciphers/:id/restore', protected_, ciphers.handleRestore)

    // ==========================================================================
    // Folders
    // ==========================================================================
    app.post('/api/folders', protected_, folders.handleCreate)
    app.get('/api/folders/:id', protected_, folders.handleGet)
    app.put('/api/folders/:id', protected_, folders.handleUpdate)
    app.delete('/api/folders/:id', protected_, folders.handleDelete)

    // ==========================================================================
    // Devices
    // ==========================================================================
    app.get('/api/devices', protected_, devices.handleList)
    app.get('/api/devices/knowndevice', devices.handleKnownDevice)
    app.delete('/api/devices/:id', protected_, devices.handleDelete)
    app.put('/api/devices/identifier/:identifier/token', protected_, devices.handleUpdateToken)
    app.put('/api/devices/identifier/:identifier/clear-token', protected_, devices.handleClearToken)

    // ==========================================================================
    // Config
    // ==========================================================================
    app.get('/api/config', config.handleConfig)
    app.get('/api/accounts/features', config.handleFeatures)
    app.get('/api/two-factor', config.handleTwoFactor)
    app.post('/api/accounts/password-hint', config.handlePasswordHint)
    app.get('/api/organizations/*/policies/token', config.handleOrganizationPolicies)
    app.get('/notifications/hub', config.handleNotificationsHub)
    app.get('/notifications/hub/negotiate', config.handleNotificationsNegotiate)
    app.get('/api/emergency-access/trusted', config.handleEmergencyAccessTrusted)
    app.get('/api/emergency-access/granted', config.handleEmergencyAccessGranted)
    app.get('/icons/:domain/icon.png', config.handleIcon)

    // ==========================================================================
    // Settings (Protected)
    // ==========================================================================
    app.get('/api/settings/domains', protected_, config.handleGetDomains)
    app.on(['PUT', 'POST'], '/api/settings/domains', protected_, config.handleUpdateDomains)
    app.post('/api/accounts/keys', protected_, config.handleKeys)
    app.post('/api/accounts/key', protected_, config.handleKey)
}
