/**
 * Ciphers API Module
 * 
 * Handles: CRUD operations for vault items (ciphers)
 * 
 * Atomicity Strategy:
 * - Create: Index first, then data (orphan index is safe, synced as empty)
 * - Delete: Data first, then index (missing index means item doesn't appear)
 * - Import: Best-effort with collected errors
 */

import { Hono } from 'hono'
import type { Bindings, Cipher, Folder } from '../types'
import { addCipherToIndex, removeCipherFromIndex, addFolderToIndex } from '../storage/kv'
import { getCipher, putCipher, deleteCipher, deleteAllAttachments, putFolder } from '../storage/s3'
import { errorResponse } from './auth'
import { createJwtMiddleware } from '../utils/auth'
import { buildCipher, validateCipher } from '../utils/cipher'

const ciphers = new Hono<{ Bindings: Bindings }>()

// Apply JWT middleware to cipher routes only
ciphers.use('/api/ciphers/*', createJwtMiddleware)
ciphers.use('/api/ciphers', createJwtMiddleware)

// --------------------------------------------------------------------------
// Create Cipher
// --------------------------------------------------------------------------

ciphers.post('/api/ciphers', async (c) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const body = await c.req.json<any>()

    const newCipher = buildCipher(body)

    const validationError = validateCipher(newCipher)
    if (validationError) {
        return errorResponse(c, validationError)
    }

    await Promise.all([
        putCipher(c.env.VAULT, userId, newCipher),
        addCipherToIndex(c.env.DB, userId, newCipher.id)
    ])

    return c.json(newCipher)
})

// --------------------------------------------------------------------------
// Import (Bulk Create)
// --------------------------------------------------------------------------

ciphers.post('/api/ciphers/import', async (c) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const body = await c.req.json<any>()

    const items = body.Ciphers || body.ciphers || []
    const folders = body.Folders || body.folders || []

    const importedCiphers: Cipher[] = []
    const importedFolders: Folder[] = []

    // Process folders first
    const folderPromises = folders
        .filter((item: any) => item.Name ?? item.name)
        .map(async (item: any) => {
            const folder: Folder = {
                id: item.Id ?? item.id ?? crypto.randomUUID(),
                name: item.Name ?? item.name,
                revisionDate: new Date().toISOString(),
                object: 'folder'
            }
            await Promise.all([
                putFolder(c.env.VAULT, userId, folder),
                addFolderToIndex(c.env.DB, userId, folder.id)
            ])
            return folder
        })

    const folderResults = await Promise.allSettled(folderPromises)
    for (const result of folderResults) {
        if (result.status === 'fulfilled') {
            importedFolders.push(result.value)
        }
    }

    // Process ciphers
    const cipherPromises = items
        .map((item: any) => buildCipher(item))
        .filter((cipher: Cipher) => !validateCipher(cipher))
        .map(async (cipher: Cipher) => {
            await Promise.all([
                putCipher(c.env.VAULT, userId, cipher),
                addCipherToIndex(c.env.DB, userId, cipher.id)
            ])
            return cipher
        })

    const cipherResults = await Promise.allSettled(cipherPromises)
    for (const result of cipherResults) {
        if (result.status === 'fulfilled') {
            importedCiphers.push(result.value)
        }
    }

    return c.json({
        ciphers: importedCiphers,
        folders: importedFolders,
        success: true
    })
})

// --------------------------------------------------------------------------
// Get Cipher
// --------------------------------------------------------------------------

ciphers.get('/api/ciphers/:id', async (c) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const cipherId = c.req.param('id')

    const cipher = await getCipher(c.env.VAULT, userId, cipherId)
    if (!cipher) {
        return errorResponse(c, 'Cipher not found', 404)
    }

    return c.json(cipher)
})

// --------------------------------------------------------------------------
// Update Cipher
// --------------------------------------------------------------------------

ciphers.put('/api/ciphers/:id', async (c) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const cipherId = c.req.param('id')
    const body = await c.req.json<any>()

    const existing = await getCipher(c.env.VAULT, userId, cipherId)

    const updatedCipher = buildCipher(body, {
        id: cipherId,
        existing,
    })

    const promises: Promise<void>[] = [
        putCipher(c.env.VAULT, userId, updatedCipher)
    ]

    if (!existing) {
        promises.push(addCipherToIndex(c.env.DB, userId, cipherId))
    }

    await Promise.all(promises)

    return c.json(updatedCipher)
})

// --------------------------------------------------------------------------
// Delete Cipher
// --------------------------------------------------------------------------

ciphers.delete('/api/ciphers/:id', async (c) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const cipherId = c.req.param('id')

    await Promise.all([
        deleteAllAttachments(c.env.VAULT, userId, cipherId),
        deleteCipher(c.env.VAULT, userId, cipherId)
    ])

    await removeCipherFromIndex(c.env.DB, userId, cipherId)

    return c.json({}, 200)
})

// --------------------------------------------------------------------------
// Soft Delete (move to trash)
// --------------------------------------------------------------------------

ciphers.put('/api/ciphers/:id/delete', async (c) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const cipherId = c.req.param('id')

    const cipher = await getCipher(c.env.VAULT, userId, cipherId)
    if (!cipher) {
        return errorResponse(c, 'Cipher not found', 404)
    }

    const now = new Date().toISOString()
    cipher.deletedDate = now
    cipher.revisionDate = now

    await putCipher(c.env.VAULT, userId, cipher)

    return c.json(cipher)
})

// --------------------------------------------------------------------------
// Restore (from trash)
// --------------------------------------------------------------------------

ciphers.put('/api/ciphers/:id/restore', async (c) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const cipherId = c.req.param('id')

    const cipher = await getCipher(c.env.VAULT, userId, cipherId)
    if (!cipher) {
        return errorResponse(c, 'Cipher not found', 404)
    }

    cipher.deletedDate = null
    cipher.revisionDate = new Date().toISOString()

    await putCipher(c.env.VAULT, userId, cipher)

    return c.json(cipher)
})

export default ciphers
