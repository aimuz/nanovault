/**
 * Sync Handlers Module
 * 
 * Exports handler functions for: Profile, Revision-Date, Sync
 */

import { Context } from 'hono'
import type { Bindings, UserData, ProfileData, SyncResponse, GlobalEquivalentDomain } from '../types'
import { getUser } from '../storage/kv'
import { listCiphers, listFolders } from '../storage/s3'
import { errorResponse } from './auth'
import { GLOBAL_EQUIVALENT_DOMAINS } from '../constants/domains'

type AppContext = Context<{ Bindings: Bindings }>

// Helper: Build profile object (camelCase)
const buildProfile = (user: UserData): ProfileData => ({
    id: user.id,
    name: user.name ?? null,
    email: user.email,
    emailVerified: true,
    premium: true,
    premiumFromOrganization: false,
    masterPasswordHint: user.masterPasswordHint ?? null,
    culture: user.culture,
    twoFactorEnabled: false,
    key: user.key,
    publicKey: user.publicKey ?? null,
    privateKey: user.encryptedPrivateKey ?? null,
    securityStamp: user.securityStamp,
    forcePasswordReset: false,
    usesKeyConnector: false,
    avatarColor: null,
    creationDate: user.createdAt,
    verifyDevices: true,
    organizations: [],
    providers: [],
    providerOrganizations: [],
    object: 'profile'
})

// --------------------------------------------------------------------------
// Profile Handler
// --------------------------------------------------------------------------

export const handleProfile = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const user = await getUser(c.env.DB, payload.email)
    if (!user) return errorResponse(c, 'User not found', 404)

    return c.json(buildProfile(user))
}

// --------------------------------------------------------------------------
// Revision Date Handler
// --------------------------------------------------------------------------

export const handleRevisionDate = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const user = await getUser(c.env.DB, payload.email)
    if (!user) return errorResponse(c, 'User not found', 404)

    return c.json(user.updatedAt || new Date().toISOString())
}

// --------------------------------------------------------------------------
// Sync Handler
// --------------------------------------------------------------------------

export const handleSync = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string

    const user = await getUser(c.env.DB, payload.email)
    if (!user) return errorResponse(c, 'User not found', 401)

    const [ciphers, folders] = await Promise.all([
        listCiphers(c.env.VAULT, userId),
        listFolders(c.env.VAULT, userId)
    ])

    const excludedGlobalTypes = user.excludedGlobalEquivalentDomains ?? []
    const globalEquivalentDomains: GlobalEquivalentDomain[] = GLOBAL_EQUIVALENT_DOMAINS.map(g => ({
        type: g.type,
        domains: g.domains,
        excluded: excludedGlobalTypes.includes(g.type)
    }))

    return c.json<SyncResponse>({
        object: 'sync',
        profile: buildProfile(user),
        folders: folders,
        ciphers: ciphers,
        domains: {
            equivalentDomains: user.equivalentDomains ?? [],
            globalEquivalentDomains,
            object: 'domains'
        }
    })
}
