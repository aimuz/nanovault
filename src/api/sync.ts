/**
 * Sync API Module
 * 
 * Handles: Sync, Profile, Revision-Date
 * 
 * The sync endpoint directly lists from S3 storage, which provides the
 * authoritative data source. This naturally handles any index inconsistencies:
 * - If index has an ID but S3 doesn't have the data: not returned (self-healing)
 * - If S3 has data but index is missing: still returned via list
 */

import { Hono } from 'hono'
import type { Bindings, UserData, ProfileData, SyncResponse, DomainsData, GlobalEquivalentDomain } from '../types'
import { getUser } from '../storage/kv'
import { listCiphers, listFolders } from '../storage/s3'
import { createJwtMiddleware } from '../utils/auth'
import { errorResponse } from './auth'
import { GLOBAL_EQUIVALENT_DOMAINS } from '../constants/domains'

const sync = new Hono<{ Bindings: Bindings }>()

// Helper: Build profile object (camelCase)
export const buildProfile = (user: UserData): ProfileData => ({
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
// Profile (Protected)
// --------------------------------------------------------------------------

sync.get('/api/accounts/profile', createJwtMiddleware, async (c) => {
    const payload = c.get('jwtPayload')
    const user = await getUser(c.env.DB, payload.email)
    if (!user) return errorResponse(c, 'User not found', 404)

    return c.json(buildProfile(user))
})

// --------------------------------------------------------------------------
// Revision Date (Protected) - for sync optimization
// --------------------------------------------------------------------------

sync.get('/api/accounts/revision-date', createJwtMiddleware, async (c) => {
    const payload = c.get('jwtPayload')
    const user = await getUser(c.env.DB, payload.email)
    if (!user) return errorResponse(c, 'User not found', 404)

    // Return the user's last update time as revision date
    return c.json(user.updatedAt || new Date().toISOString())
})

// --------------------------------------------------------------------------
// Sync (Protected)
// --------------------------------------------------------------------------

sync.get('/api/sync', createJwtMiddleware, async (c) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string

    const user = await getUser(c.env.DB, payload.email)
    if (!user) return errorResponse(c, 'User not found', 401)

    // Fetch all ciphers and folders from S3 directly.
    // This is the authoritative source - any index inconsistencies are ignored.
    const [ciphers, folders] = await Promise.all([
        listCiphers(c.env.VAULT, userId),
        listFolders(c.env.VAULT, userId)
    ])

    // Build domains response with user's settings
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
})

export default sync
