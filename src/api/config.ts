/**
 * Config Handlers Module
 * 
 * Exports handler functions for server configuration and stubs for unsupported features
 */

import { Context } from 'hono'
import type { Bindings, DomainsData, GlobalEquivalentDomain } from '../types'
import { getUser, putUser } from '../storage/kv'
import { errorResponse } from './auth'
import { GLOBAL_EQUIVALENT_DOMAINS } from '../constants/domains'

type AppContext = Context<{ Bindings: Bindings }>

// --------------------------------------------------------------------------
// Helper Functions
// --------------------------------------------------------------------------

const buildDomainsResponse = (
    userEquivalentDomains: string[][] = [],
    excludedGlobalTypes: number[] = []
): DomainsData => {
    const globalEquivalentDomains: GlobalEquivalentDomain[] = GLOBAL_EQUIVALENT_DOMAINS.map(g => ({
        type: g.type,
        domains: g.domains,
        excluded: excludedGlobalTypes.includes(g.type)
    }))

    return {
        equivalentDomains: userEquivalentDomains,
        globalEquivalentDomains,
        object: 'domains'
    }
}

const parseDomainSettings = (body: any): {
    equivalentDomains: string[][],
    excludedGlobalTypes: number[],
    error?: string
} => {
    const equivalentDomains = body.equivalentDomains ?? body.EquivalentDomains ?? []
    const globalEquivalentDomains = body.globalEquivalentDomains ?? body.GlobalEquivalentDomains ?? []

    if (!Array.isArray(equivalentDomains)) {
        return { equivalentDomains: [], excludedGlobalTypes: [], error: 'equivalentDomains must be an array' }
    }
    for (const group of equivalentDomains) {
        if (!Array.isArray(group) || !group.every(d => typeof d === 'string')) {
            return { equivalentDomains: [], excludedGlobalTypes: [], error: 'Each equivalentDomains group must be an array of strings' }
        }
    }

    const excludedGlobalTypes: number[] = Array.isArray(globalEquivalentDomains)
        ? globalEquivalentDomains
            .filter(g => g && typeof g.type === 'number' && g.excluded === true)
            .map(g => g.type)
        : []

    return { equivalentDomains, excludedGlobalTypes }
}

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

// --------------------------------------------------------------------------
// Server Config Handler (Public)
// --------------------------------------------------------------------------

export const handleConfig = (c: AppContext) => {
    const baseUrl = new URL(c.req.url).origin
    const environment = {
        vault: baseUrl,
        api: baseUrl,
        identity: baseUrl,
        notifications: baseUrl,
        sso: ''
    }
    return c.json({
        settings: {
            environment
        },
        environment,
        version: '2.0.0',
        object: 'config'
    })
}

// --------------------------------------------------------------------------
// Features Handler (Public)
// --------------------------------------------------------------------------

export const handleFeatures = (c: AppContext) => {
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
}

// --------------------------------------------------------------------------
// Stub Handlers
// --------------------------------------------------------------------------

export const handleTwoFactor = (c: AppContext) => c.json([], 200)
export const handlePasswordHint = (c: AppContext) => c.json({})
export const handleOrganizationPolicies = (c: AppContext) => c.json([], 200)
export const handleNotificationsHub = (c: AppContext) => c.json({ message: 'Notifications not supported' }, 200)
export const handleNotificationsNegotiate = (c: AppContext) => c.json({ connectionId: '', availableTransports: [] }, 200)
export const handleEmergencyAccessTrusted = (c: AppContext) => c.json({ data: [], object: 'list', continuationToken: null })
export const handleEmergencyAccessGranted = (c: AppContext) => c.json({ data: [], object: 'list', continuationToken: null })

// --------------------------------------------------------------------------
// Get Domains Handler (Protected)
// --------------------------------------------------------------------------

export const handleGetDomains = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const user = await getUser(c.env.DB, payload.email)
    if (!user) return errorResponse(c, 'User not found', 404)

    return c.json(buildDomainsResponse(
        user.equivalentDomains ?? [],
        user.excludedGlobalEquivalentDomains ?? []
    ))
}

// --------------------------------------------------------------------------
// Update Domains Handler (Protected)
// --------------------------------------------------------------------------

export const handleUpdateDomains = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const user = await getUser(c.env.DB, payload.email)
    if (!user) return errorResponse(c, 'User not found', 404)

    const body = await c.req.json<any>()
    const { equivalentDomains, excludedGlobalTypes, error } = parseDomainSettings(body)

    if (error) return errorResponse(c, error, 400)

    user.equivalentDomains = equivalentDomains
    user.excludedGlobalEquivalentDomains = excludedGlobalTypes
    user.updatedAt = new Date().toISOString()

    await putUser(c.env.DB, user)

    return c.json(buildDomainsResponse(equivalentDomains, excludedGlobalTypes))
}

// --------------------------------------------------------------------------
// Icons Handler
// --------------------------------------------------------------------------

export const handleIcon = (c: AppContext) => {
    const domain = c.req.param('domain')
    if (isPrivateIP(domain)) {
        return c.body(null, 204)
    }
    return c.redirect(`https://goproxy.aimuz.me/${domain}/icon.png`, 302)
}

// --------------------------------------------------------------------------
// Keys Handler (Protected)
// --------------------------------------------------------------------------

export const handleKeys = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const body = await c.req.json<any>()

    const user = await getUser(c.env.DB, payload.email)
    if (!user) return errorResponse(c, 'User not found', 404)

    const pubKey = body.PublicKey ?? body.publicKey
    const privKey = body.EncryptedPrivateKey ?? body.encryptedPrivateKey
    if (pubKey) user.publicKey = pubKey
    if (privKey) user.encryptedPrivateKey = privKey
    user.updatedAt = new Date().toISOString()

    await putUser(c.env.DB, user)

    return c.json({})
}

// --------------------------------------------------------------------------
// Key Handler (Protected)
// --------------------------------------------------------------------------

export const handleKey = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const body = await c.req.json<any>()

    const user = await getUser(c.env.DB, payload.email)
    if (!user) return errorResponse(c, 'User not found', 404)

    const newKey = body.Key ?? body.key
    if (newKey) user.key = newKey

    const newHash = body.MasterPasswordHash ?? body.masterPasswordHash
    if (newHash) {
        user.masterPasswordHash = newHash
        user.securityStamp = crypto.randomUUID()
    }

    user.updatedAt = new Date().toISOString()
    await putUser(c.env.DB, user)

    return c.json({})
}
