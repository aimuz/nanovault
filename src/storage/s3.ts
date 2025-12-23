/**
 * S3/R2 Storage Layer
 * 
 * Handles all S3 operations for vault data (ciphers, folders, attachments).
 * Object paths:
 *   vaults/{userId}/ciphers/{cipherId}.json
 *   vaults/{userId}/folders/{folderId}.json
 *   vaults/{userId}/attachments/{attachmentId}
 */

import type { Cipher, Folder, AttachmentMeta } from '../types'

// --------------------------------------------------------------------------
// Cipher Operations
// --------------------------------------------------------------------------

const cipherKey = (userId: string, cipherId: string): string => {
    return `vaults/${userId}/ciphers/${cipherId}.json`
}

export const getCipher = async (bucket: R2Bucket, userId: string, cipherId: string): Promise<Cipher | null> => {
    const obj = await bucket.get(cipherKey(userId, cipherId))
    if (!obj) return null
    return await obj.json() as Cipher
}

export const putCipher = async (bucket: R2Bucket, userId: string, cipher: Cipher): Promise<void> => {
    await bucket.put(cipherKey(userId, cipher.id), JSON.stringify(cipher), {
        httpMetadata: { contentType: 'application/json' }
    })
}

export const deleteCipher = async (bucket: R2Bucket, userId: string, cipherId: string): Promise<void> => {
    await bucket.delete(cipherKey(userId, cipherId))
}

export const listCiphers = async (bucket: R2Bucket, userId: string): Promise<Cipher[]> => {
    const prefix = `vaults/${userId}/ciphers/`
    const listed = await bucket.list({ prefix })

    const ciphers: Cipher[] = []
    for (const obj of listed.objects) {
        const data = await bucket.get(obj.key)
        if (data) {
            ciphers.push(await data.json() as Cipher)
        }
    }
    return ciphers
}

// --------------------------------------------------------------------------
// Folder Operations
// --------------------------------------------------------------------------

const folderKey = (userId: string, folderId: string): string => {
    return `vaults/${userId}/folders/${folderId}.json`
}

export const getFolder = async (bucket: R2Bucket, userId: string, folderId: string): Promise<Folder | null> => {
    const obj = await bucket.get(folderKey(userId, folderId))
    if (!obj) return null
    return await obj.json() as Folder
}

export const putFolder = async (bucket: R2Bucket, userId: string, folder: Folder): Promise<void> => {
    await bucket.put(folderKey(userId, folder.id), JSON.stringify(folder), {
        httpMetadata: { contentType: 'application/json' }
    })
}

export const deleteFolder = async (bucket: R2Bucket, userId: string, folderId: string): Promise<void> => {
    await bucket.delete(folderKey(userId, folderId))
}

export const listFolders = async (bucket: R2Bucket, userId: string): Promise<Folder[]> => {
    const prefix = `vaults/${userId}/folders/`
    const listed = await bucket.list({ prefix })

    const folders: Folder[] = []
    for (const obj of listed.objects) {
        const data = await bucket.get(obj.key)
        if (data) {
            folders.push(await data.json() as Folder)
        }
    }
    return folders
}

// --------------------------------------------------------------------------
// Attachment Operations
// --------------------------------------------------------------------------

const attachmentKey = (userId: string, cipherId: string, attachmentId: string): string => {
    return `vaults/${userId}/attachments/${cipherId}/${attachmentId}`
}

export const getAttachment = async (bucket: R2Bucket, userId: string, cipherId: string, attachmentId: string): Promise<R2ObjectBody | null> => {
    return await bucket.get(attachmentKey(userId, cipherId, attachmentId))
}

export const putAttachment = async (
    bucket: R2Bucket,
    userId: string,
    cipherId: string,
    attachmentId: string,
    data: ArrayBuffer | ReadableStream,
    meta: { contentType?: string; fileName?: string }
): Promise<void> => {
    await bucket.put(attachmentKey(userId, cipherId, attachmentId), data, {
        httpMetadata: { contentType: meta.contentType || 'application/octet-stream' },
        customMetadata: { fileName: meta.fileName || '' }
    })
}

export const deleteAttachment = async (bucket: R2Bucket, userId: string, cipherId: string, attachmentId: string): Promise<void> => {
    await bucket.delete(attachmentKey(userId, cipherId, attachmentId))
}

// Delete all attachments for a cipher
export const deleteAllAttachments = async (bucket: R2Bucket, userId: string, cipherId: string): Promise<void> => {
    const prefix = `vaults/${userId}/attachments/${cipherId}/`
    const listed = await bucket.list({ prefix })

    for (const obj of listed.objects) {
        await bucket.delete(obj.key)
    }
}

// Delete entire vault for a user (for account deletion)
export const deleteVault = async (bucket: R2Bucket, userId: string): Promise<void> => {
    const prefix = `vaults/${userId}/`
    const listed = await bucket.list({ prefix })

    for (const obj of listed.objects) {
        await bucket.delete(obj.key)
    }
}
