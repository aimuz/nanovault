/**
 * KV Storage Layer
 * 
 * Handles all KV operations for user data and vault indices.
 * Keys:
 *   user:{email}        -> UserData JSON
 *   user_id:{id}        -> email (index for ID lookups)
 *   vault_index:{userId} -> VaultIndex JSON
 */

import type { UserData, VaultIndex } from '../types'

// --------------------------------------------------------------------------
// User Operations
// --------------------------------------------------------------------------

export async function getUser(kv: KVNamespace, email: string): Promise<UserData | null> {
    const json = await kv.get(`user:${email.toLowerCase()}`)
    if (!json) return null
    return JSON.parse(json) as UserData
}

export async function putUser(kv: KVNamespace, user: UserData): Promise<void> {
    const email = user.email.toLowerCase()

    // Store user data
    await kv.put(`user:${email}`, JSON.stringify(user))

    // Store ID -> email index for getUserById
    await kv.put(`user_id:${user.id}`, email)
}

export async function getUserById(kv: KVNamespace, id: string): Promise<UserData | null> {
    const email = await kv.get(`user_id:${id}`)
    if (!email) return null
    return getUser(kv, email)
}

export async function deleteUser(kv: KVNamespace, user: UserData): Promise<void> {
    const email = user.email.toLowerCase()
    await kv.delete(`user:${email}`)
    await kv.delete(`user_id:${user.id}`)
    await kv.delete(`vault_index:${user.id}`)
}

// --------------------------------------------------------------------------
// Vault Index Operations
// --------------------------------------------------------------------------

export async function getVaultIndex(kv: KVNamespace, userId: string): Promise<VaultIndex> {
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

export async function putVaultIndex(kv: KVNamespace, userId: string, index: VaultIndex): Promise<void> {
    index.revision = new Date().toISOString()
    await kv.put(`vault_index:${userId}`, JSON.stringify(index))
}

export async function addCipherToIndex(kv: KVNamespace, userId: string, cipherId: string): Promise<void> {
    const index = await getVaultIndex(kv, userId)
    if (!index.cipherIds.includes(cipherId)) {
        index.cipherIds.push(cipherId)
        await putVaultIndex(kv, userId, index)
    }
}

export async function removeCipherFromIndex(kv: KVNamespace, userId: string, cipherId: string): Promise<void> {
    const index = await getVaultIndex(kv, userId)
    const i = index.cipherIds.indexOf(cipherId)
    if (i !== -1) {
        index.cipherIds.splice(i, 1)
        await putVaultIndex(kv, userId, index)
    }
}

export async function addFolderToIndex(kv: KVNamespace, userId: string, folderId: string): Promise<void> {
    const index = await getVaultIndex(kv, userId)
    if (!index.folderIds.includes(folderId)) {
        index.folderIds.push(folderId)
        await putVaultIndex(kv, userId, index)
    }
}

export async function removeFolderFromIndex(kv: KVNamespace, userId: string, folderId: string): Promise<void> {
    const index = await getVaultIndex(kv, userId)
    const i = index.folderIds.indexOf(folderId)
    if (i !== -1) {
        index.folderIds.splice(i, 1)
        await putVaultIndex(kv, userId, index)
    }
}
