/**
 * Config API Module
 * 
 * Handles: Server configuration and stubs for unsupported features
 */

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { getUser, putUser } from '../storage/kv'
import { errorResponse } from './auth'
import { createJwtMiddleware } from '../utils/auth'

const config = new Hono<{ Bindings: Bindings }>()

// --------------------------------------------------------------------------
// Server Config (Public)
// --------------------------------------------------------------------------

config.get('/api/config', (c) => {
    const baseUrl = new URL(c.req.url).origin
    return c.json({
        settings: {
            environment: {
                vault: baseUrl,
                api: baseUrl,
                identity: baseUrl,
                notifications: baseUrl,
                sso: ''
            }
        },
        environment: {
            vault: baseUrl,
            api: baseUrl,
            identity: baseUrl,
            notifications: baseUrl,
            sso: ''
        },
        version: '2.0.0',
        object: 'config'
    })
})

// --------------------------------------------------------------------------
// Features (Public)
// --------------------------------------------------------------------------

config.get('/api/accounts/features', (c) => {
    return c.json({
        '2fa': false,
        'directory-sync': false,
        'events': false,
        'groups': false,
        'import-export': true,
        'password-history': true,
        'password-generator': true,
        'premium': true,
        'self-host': true
    })
})

// --------------------------------------------------------------------------
// Stubs (Various)
// --------------------------------------------------------------------------

config.get('/api/devices/knowndevice', (c) => c.json({}))
config.get('/api/two-factor', (c) => c.json([], 200))
config.post('/api/accounts/password-hint', (c) => c.json({}))
config.get('/api/organizations/*/policies/token', (c) => c.json([], 200))

// Notifications hub stub (WebSocket not supported, return empty)
config.get('/notifications/hub', (c) => c.json({ message: 'Notifications not supported' }, 200))
config.get('/notifications/hub/negotiate', (c) => c.json({ connectionId: '', availableTransports: [] }, 200))

// Settings/Domains stub
config.get('/api/settings/domains', (c) => c.json({
    equivalentDomains: [],
    globalEquivalentDomains: [],
    object: 'domains'
}))

// Emergency Access stubs
config.get('/api/emergency-access/trusted', (c) => c.json({
    data: [],
    object: 'list',
    continuationToken: null
}))
config.get('/api/emergency-access/granted', (c) => c.json({
    data: [],
    object: 'list',
    continuationToken: null
}))

// --------------------------------------------------------------------------
// Icons Proxy (Website favicons)
// --------------------------------------------------------------------------

// Helper: Check if domain is a private/internal IP
const isPrivateIP = (domain: string): boolean => {
    const privatePatterns = [
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^192\.168\./,
        /^127\./,
        /^169\.254\./,
        /^localhost$/i,
    ]
    return privatePatterns.some(pattern => pattern.test(domain))
}

config.get('/icons/:domain/icon.png', (c) => {
    const domain = c.req.param('domain')
    if (isPrivateIP(domain)) {
        return c.body(null, 204)
    }
    return c.redirect(`https://goproxy.aimuz.me/${domain}/icon.png`, 302)
})

// --------------------------------------------------------------------------
// Keys (Protected)
// --------------------------------------------------------------------------

config.post('/api/accounts/keys', createJwtMiddleware, async (c) => {
    const payload = c.get('jwtPayload')
    const body = await c.req.json<any>()

    const user = await getUser(c.env.DB, payload.email)
    if (!user) return errorResponse(c, 'User not found', 404)

    // Update RSA keys (handle both cases)
    const pubKey = body.PublicKey ?? body.publicKey
    const privKey = body.EncryptedPrivateKey ?? body.encryptedPrivateKey
    if (pubKey) user.publicKey = pubKey
    if (privKey) user.encryptedPrivateKey = privKey
    user.updatedAt = new Date().toISOString()

    await putUser(c.env.DB, user)

    return c.json({})
})

config.post('/api/accounts/key', createJwtMiddleware, async (c) => {
    const payload = c.get('jwtPayload')
    const body = await c.req.json<any>()

    const user = await getUser(c.env.DB, payload.email)
    if (!user) return errorResponse(c, 'User not found', 404)

    // Update encryption key (handle both cases)
    const newKey = body.Key ?? body.key
    if (newKey) user.key = newKey

    // Also handle master password hash update if provided
    const newHash = body.MasterPasswordHash ?? body.masterPasswordHash
    if (newHash) {
        user.masterPasswordHash = newHash
        user.securityStamp = crypto.randomUUID()
    }

    user.updatedAt = new Date().toISOString()
    await putUser(c.env.DB, user)

    return c.json({})
})

export default config
