/**
 * Ciphers Handlers Module
 * 
 * Exports handler functions for: CRUD operations for vault items (ciphers)
 */

import { Context } from 'hono'
import type { Bindings, Cipher, Folder } from '../types'
import { addCipherToIndex, removeCipherFromIndex, addFolderToIndex } from '../storage/kv'
import { getCipher, putCipher, deleteCipher, deleteAllAttachments, putFolder } from '../storage/s3'
import { errorResponse } from './auth'
import { notifyCipherCreate, notifyCipherUpdate, notifyCipherDelete } from './push'

type AppContext = Context<{ Bindings: Bindings }>


/**
 * Options for building a cipher object.
 */
interface BuildCipherOptions {
    /** Existing cipher to merge with (for updates) */
    existing?: Cipher | null
    /** Override the cipher ID */
    id?: string
    /** Creation timestamp (defaults to now) */
    creationDate?: string
}

/**
 * Builds a normalized Cipher object from request body.
 * 
 * @param body - Raw request body from client (camelCase)
 * @param opts - Optional build configuration
 * @returns A normalized Cipher object
 */
const buildCipher = (body: Record<string, any>, opts: BuildCipherOptions = {}): Cipher => {
    const { existing, id, creationDate } = opts
    const now = new Date().toISOString()

    return {
        id: id ?? body.id ?? crypto.randomUUID(),
        type: body.type ?? existing?.type ?? 1,
        organizationId: body.organizationId ?? null,
        folderId: body.folderId ?? null,
        favorite: body.favorite ?? false,
        reprompt: body.reprompt ?? 0,
        name: body.name ?? '',
        notes: body.notes ?? null,
        fields: body.fields ?? null,
        login: body.login ?? null,
        card: body.card ?? null,
        identity: body.identity ?? null,
        secureNote: body.secureNote ?? null,
        sshKey: body.sshKey ?? null,
        revisionDate: now,
        creationDate: creationDate ?? existing?.creationDate ?? now,
        deletedDate: null,
        archivedDate: body.archivedDate ?? null,
        key: body.key ?? null,
        passwordHistory: body.passwordHistory ?? existing?.passwordHistory ?? null,
        edit: true,
        viewPassword: true,
        organizationUseTotp: false,
        data: body.data,
        object: 'cipher',
        attachments: body.attachments ?? null,
        collectionIds: body.collectionIds ?? [],
    }
}

/**
 * Validates that a cipher has required fields.
 * 
 * @param cipher - The cipher to validate
 * @returns Error message if invalid, null if valid
 */
const validateCipher = (cipher: Cipher): string | null => {
    if (cipher.type === undefined) {
        return 'Invalid cipher data: Type required'
    }
    if (!cipher.name) {
        return 'Invalid cipher data: Name required'
    }
    return null
}


// --------------------------------------------------------------------------
// Create Cipher Handler
// --------------------------------------------------------------------------

export const handleCreate = async (c: AppContext) => {
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

    notifyCipherCreate(c.env, userId, newCipher.id, newCipher.revisionDate)

    return c.json(newCipher)
}

// --------------------------------------------------------------------------
// Import Handler (Bulk Create)
// --------------------------------------------------------------------------

export const handleImport = async (c: AppContext) => {
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
}

// --------------------------------------------------------------------------
// Get Cipher Handler
// --------------------------------------------------------------------------

export const handleGet = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const cipherId = c.req.param('id')

    const cipher = await getCipher(c.env.VAULT, userId, cipherId)
    if (!cipher) {
        return errorResponse(c, 'Cipher not found', 404)
    }

    return c.json(cipher)
}

// --------------------------------------------------------------------------
// Update Cipher Handler
// --------------------------------------------------------------------------

export const handleUpdate = async (c: AppContext) => {
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

    notifyCipherUpdate(c.env, userId, updatedCipher.id, updatedCipher.revisionDate)

    return c.json(updatedCipher)
}

// --------------------------------------------------------------------------
// Delete Cipher Handler
// --------------------------------------------------------------------------

export const handleDelete = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const cipherId = c.req.param('id')

    await Promise.all([
        deleteAllAttachments(c.env.VAULT, userId, cipherId),
        deleteCipher(c.env.VAULT, userId, cipherId)
    ])

    await removeCipherFromIndex(c.env.DB, userId, cipherId)

    notifyCipherDelete(c.env, userId, cipherId)

    return c.json({}, 200)
}

// --------------------------------------------------------------------------
// Soft Delete Handler (move to trash)
// --------------------------------------------------------------------------

export const handleSoftDelete = async (c: AppContext) => {
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
}

// --------------------------------------------------------------------------
// Restore Handler (from trash)
// --------------------------------------------------------------------------

export const handleRestore = async (c: AppContext) => {
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
}
