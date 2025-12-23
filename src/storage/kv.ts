/**
 * KV Storage Layer
 * 
 * Handles all KV operations for user data and vault indices.
 * Keys:
 *   user:{email}         -> UserData JSON
 *   vault_index:{userId} -> VaultIndex JSON
 */

import type { UserData, VaultIndex, Device } from '../types'

// --------------------------------------------------------------------------
// User Operations
// --------------------------------------------------------------------------

export const getUser = async (kv: KVNamespace, email: string): Promise<UserData | null> => {
    const json = await kv.get(`user:${email.toLowerCase()}`)
    if (!json) return null
    return JSON.parse(json) as UserData
}

export const putUser = async (kv: KVNamespace, user: UserData): Promise<void> => {
    await kv.put(`user:${user.email.toLowerCase()}`, JSON.stringify(user))
}

export const deleteUser = async (kv: KVNamespace, user: UserData): Promise<void> => {
    const email = user.email.toLowerCase()
    await kv.delete(`user:${email}`)
    await kv.delete(`vault_index:${user.id}`)
}

// --------------------------------------------------------------------------
// Vault Index Operations
// --------------------------------------------------------------------------

export const getVaultIndex = async (kv: KVNamespace, userId: string): Promise<VaultIndex> => {
    const json = await kv.get(`vault_index:${userId}`)
    if (!json) {
        return {
            cipherIds: [],
            folderIds: [],
            revision: new Date().toISOString()
        }
    }
    return JSON.parse(json) as VaultIndex
}

export const putVaultIndex = async (kv: KVNamespace, userId: string, index: VaultIndex): Promise<void> => {
    index.revision = new Date().toISOString()
    await kv.put(`vault_index:${userId}`, JSON.stringify(index))
}

export const addCipherToIndex = async (kv: KVNamespace, userId: string, cipherId: string): Promise<void> => {
    const index = await getVaultIndex(kv, userId)
    if (!index.cipherIds.includes(cipherId)) {
        index.cipherIds.push(cipherId)
        await putVaultIndex(kv, userId, index)
    }
}

export const removeCipherFromIndex = async (kv: KVNamespace, userId: string, cipherId: string): Promise<void> => {
    const index = await getVaultIndex(kv, userId)
    const i = index.cipherIds.indexOf(cipherId)
    if (i !== -1) {
        index.cipherIds.splice(i, 1)
        await putVaultIndex(kv, userId, index)
    }
}

export const addFolderToIndex = async (kv: KVNamespace, userId: string, folderId: string): Promise<void> => {
    const index = await getVaultIndex(kv, userId)
    if (!index.folderIds.includes(folderId)) {
        index.folderIds.push(folderId)
        await putVaultIndex(kv, userId, index)
    }
}

export const removeFolderFromIndex = async (kv: KVNamespace, userId: string, folderId: string): Promise<void> => {
    const index = await getVaultIndex(kv, userId)
    const i = index.folderIds.indexOf(folderId)
    if (i !== -1) {
        index.folderIds.splice(i, 1)
        await putVaultIndex(kv, userId, index)
    }
}

// --------------------------------------------------------------------------
// Device Operations (for push notifications)
// Keys: device:{identifier} -> Device JSON
//       device_index:{userId} -> string[] of device identifiers
// --------------------------------------------------------------------------

export const getDevice = async (kv: KVNamespace, identifier: string): Promise<Device | null> => {
    const json = await kv.get(`device:${identifier}`)
    if (!json) return null
    return JSON.parse(json) as Device
}

export const getDevicesByUser = async (kv: KVNamespace, userId: string): Promise<Device[]> => {
    const indexJson = await kv.get(`device_index:${userId}`)
    if (!indexJson) return []

    const identifiers: string[] = JSON.parse(indexJson)
    const devices: Device[] = []

    for (const id of identifiers) {
        const device = await getDevice(kv, id)
        if (device) devices.push(device)
    }

    return devices
}

export const putDevice = async (kv: KVNamespace, device: Device): Promise<void> => {
    await kv.put(`device:${device.identifier}`, JSON.stringify(device))

    // Update user's device index
    const indexJson = await kv.get(`device_index:${device.userId}`)
    const identifiers: string[] = indexJson ? JSON.parse(indexJson) : []

    if (!identifiers.includes(device.identifier)) {
        identifiers.push(device.identifier)
        await kv.put(`device_index:${device.userId}`, JSON.stringify(identifiers))
    }
}

export const deleteDevice = async (kv: KVNamespace, device: Device): Promise<void> => {
    await kv.delete(`device:${device.identifier}`)

    // Update user's device index
    const indexJson = await kv.get(`device_index:${device.userId}`)
    if (indexJson) {
        const identifiers: string[] = JSON.parse(indexJson)
        const i = identifiers.indexOf(device.identifier)
        if (i !== -1) {
            identifiers.splice(i, 1)
            await kv.put(`device_index:${device.userId}`, JSON.stringify(identifiers))
        }
    }
}
