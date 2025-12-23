/**
 * Push Notification Module
 * 
 * Integrates with Bitwarden's push relay service for mobile notifications.
 * Requires PUSH_INSTALLATION_ID and PUSH_INSTALLATION_KEY from bitwarden.com/host
 */

import type { Bindings, Device } from '../types'

// Default Bitwarden push endpoints (US region)
const DEFAULT_PUSH_RELAY_URI = 'https://push.bitwarden.com'
const DEFAULT_PUSH_IDENTITY_URI = 'https://identity.bitwarden.com'

// Notification types
export const NOTIFICATION_TYPE = {
    SyncCipherUpdate: 0,
    SyncCipherCreate: 1,
    SyncLoginDelete: 2,
    SyncFolderDelete: 3,
    SyncCiphers: 4,
    SyncVault: 5,
    SyncOrgKeys: 6,
    SyncFolderCreate: 7,
    SyncFolderUpdate: 8,
    SyncCipherDelete: 9,
    SyncSettings: 10,
    LogOut: 11,
    SyncSendCreate: 12,
    SyncSendUpdate: 13,
    SyncSendDelete: 14,
    AuthRequest: 15,
    AuthRequestResponse: 16,
    SyncOrganizations: 17,
} as const

// Token cache (in-memory, per-worker instance)
let cachedToken: { token: string; expiresAt: number } | null = null

/**
 * Check if push notifications are enabled
 */
export const isPushEnabled = (env: Bindings): boolean => {
    return env.PUSH_ENABLED === 'true' &&
        !!env.PUSH_INSTALLATION_ID &&
        !!env.PUSH_INSTALLATION_KEY
}

/**
 * Get push relay URI
 */
const getRelayUri = (env: Bindings): string => {
    return env.PUSH_RELAY_URI || DEFAULT_PUSH_RELAY_URI
}

/**
 * Get identity URI
 */
const getIdentityUri = (env: Bindings): string => {
    return env.PUSH_IDENTITY_URI || DEFAULT_PUSH_IDENTITY_URI
}

/**
 * Get OAuth access token from Bitwarden identity service
 * Tokens are cached in memory until expiry
 */
const getAccessToken = async (env: Bindings): Promise<string> => {
    // Check cache
    if (cachedToken && Date.now() < cachedToken.expiresAt) {
        return cachedToken.token
    }

    const identityUri = getIdentityUri(env)
    const response = await fetch(`${identityUri}/connect/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            scope: 'api.push',
            client_id: `installation.${env.PUSH_INSTALLATION_ID}`,
            client_secret: env.PUSH_INSTALLATION_KEY!,
        }).toString(),
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(`Failed to get push access token: ${response.status} ${text}`)
    }

    const data = await response.json() as { access_token: string; expires_in: number }

    // Cache token with 5 min buffer before expiry
    cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 300) * 1000,
    }

    return data.access_token
}

/**
 * Register a device with Bitwarden's push service
 * Returns the push UUID for this device
 */
export const registerDevice = async (
    env: Bindings,
    userId: string,
    device: Device
): Promise<string | null> => {
    if (!isPushEnabled(env) || !device.pushToken) {
        return null
    }

    try {
        const token = await getAccessToken(env)
        const relayUri = getRelayUri(env)

        const response = await fetch(`${relayUri}/push/register`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId: userId,
                deviceId: device.identifier,
                identifier: device.identifier,
                type: device.type,
                pushToken: device.pushToken,
            }),
        })

        if (!response.ok) {
            console.error(`[Push] Failed to register device: ${response.status}`)
            return null
        }

        const data = await response.json() as { id: string }
        console.log(`[Push] Device registered: ${device.identifier} -> ${data.id}`)
        return data.id
    } catch (error) {
        console.error('[Push] Device registration error:', error)
        return null
    }
}

/**
 * Delete a device from Bitwarden's push service
 */
export const deleteDevice = async (
    env: Bindings,
    pushUuid: string
): Promise<boolean> => {
    if (!isPushEnabled(env) || !pushUuid) {
        return false
    }

    try {
        const token = await getAccessToken(env)
        const relayUri = getRelayUri(env)

        const response = await fetch(`${relayUri}/push/${pushUuid}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        })

        if (!response.ok && response.status !== 404) {
            console.error(`[Push] Failed to delete device: ${response.status}`)
            return false
        }

        console.log(`[Push] Device deleted: ${pushUuid}`)
        return true
    } catch (error) {
        console.error('[Push] Device deletion error:', error)
        return false
    }
}

/**
 * Send a push notification to a user's devices
 */
export const sendNotification = async (
    env: Bindings,
    userId: string,
    type: number,
    payload?: { id?: string; revisionDate?: string }
): Promise<boolean> => {
    if (!isPushEnabled(env)) {
        return false
    }

    try {
        const token = await getAccessToken(env)
        const relayUri = getRelayUri(env)

        const response = await fetch(`${relayUri}/push/send`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId: userId,
                type: type,
                payload: payload || {},
            }),
        })

        if (!response.ok) {
            console.error(`[Push] Failed to send notification: ${response.status}`)
            return false
        }

        console.log(`[Push] Notification sent: type=${type} user=${userId}`)
        return true
    } catch (error) {
        console.error('[Push] Send notification error:', error)
        return false
    }
}

/**
 * Send cipher update notification
 */
export const notifyCipherUpdate = async (
    env: Bindings,
    userId: string,
    cipherId: string,
    revisionDate: string
): Promise<void> => {
    await sendNotification(env, userId, NOTIFICATION_TYPE.SyncCipherUpdate, {
        id: cipherId,
        revisionDate,
    })
}

/**
 * Send cipher create notification
 */
export const notifyCipherCreate = async (
    env: Bindings,
    userId: string,
    cipherId: string,
    revisionDate: string
): Promise<void> => {
    await sendNotification(env, userId, NOTIFICATION_TYPE.SyncCipherCreate, {
        id: cipherId,
        revisionDate,
    })
}

/**
 * Send cipher delete notification
 */
export const notifyCipherDelete = async (
    env: Bindings,
    userId: string,
    cipherId: string
): Promise<void> => {
    await sendNotification(env, userId, NOTIFICATION_TYPE.SyncCipherDelete, {
        id: cipherId,
    })
}

/**
 * Send folder update notification
 */
export const notifyFolderUpdate = async (
    env: Bindings,
    userId: string,
    folderId: string,
    revisionDate: string
): Promise<void> => {
    await sendNotification(env, userId, NOTIFICATION_TYPE.SyncFolderUpdate, {
        id: folderId,
        revisionDate,
    })
}

/**
 * Send folder create notification
 */
export const notifyFolderCreate = async (
    env: Bindings,
    userId: string,
    folderId: string,
    revisionDate: string
): Promise<void> => {
    await sendNotification(env, userId, NOTIFICATION_TYPE.SyncFolderCreate, {
        id: folderId,
        revisionDate,
    })
}

/**
 * Send folder delete notification
 */
export const notifyFolderDelete = async (
    env: Bindings,
    userId: string,
    folderId: string
): Promise<void> => {
    await sendNotification(env, userId, NOTIFICATION_TYPE.SyncFolderDelete, {
        id: folderId,
    })
}

/**
 * Send logout notification (forces sync on all devices)
 */
export const notifyLogout = async (
    env: Bindings,
    userId: string
): Promise<void> => {
    await sendNotification(env, userId, NOTIFICATION_TYPE.LogOut)
}
