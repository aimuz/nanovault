/**
 * Folders API Module
 * 
 * Handles: CRUD operations for folders
 * 
 * Atomicity Strategy: Same as ciphers - parallel writes, ordered deletes.
 */

import { Hono } from 'hono'
import type { Bindings, Folder } from '../types'
import { addFolderToIndex, removeFolderFromIndex } from '../storage/kv'
import { getFolder, putFolder, deleteFolder } from '../storage/s3'
import { errorResponse } from './auth'
import { createJwtMiddleware } from '../utils/auth'

const folders = new Hono<{ Bindings: Bindings }>()

// Apply JWT middleware to folder routes only
folders.use('/api/folders/*', createJwtMiddleware)
folders.use('/api/folders', createJwtMiddleware)

// --------------------------------------------------------------------------
// Helper: Build folder from request body
// --------------------------------------------------------------------------

function buildFolder(body: Record<string, any>, id?: string): Folder {
    return {
        id: id ?? body.Id ?? body.id ?? crypto.randomUUID(),
        name: body.Name ?? body.name ?? '',
        revisionDate: new Date().toISOString(),
        object: 'folder'
    }
}

// --------------------------------------------------------------------------
// Create Folder
// --------------------------------------------------------------------------

folders.post('/api/folders', async (c) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const body = await c.req.json<any>()

    const newFolder = buildFolder(body)

    if (!newFolder.name) {
        return errorResponse(c, 'Folder name required')
    }

    await Promise.all([
        putFolder(c.env.VAULT, userId, newFolder),
        addFolderToIndex(c.env.DB, userId, newFolder.id)
    ])

    return c.json(newFolder)
})

// --------------------------------------------------------------------------
// Get Folder
// --------------------------------------------------------------------------

folders.get('/api/folders/:id', async (c) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const folderId = c.req.param('id')

    const folder = await getFolder(c.env.VAULT, userId, folderId)
    if (!folder) {
        return errorResponse(c, 'Folder not found', 404)
    }

    return c.json(folder)
})

// --------------------------------------------------------------------------
// Update Folder
// --------------------------------------------------------------------------

folders.put('/api/folders/:id', async (c) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const folderId = c.req.param('id')
    const body = await c.req.json<any>()

    const existing = await getFolder(c.env.VAULT, userId, folderId)
    const updatedFolder = buildFolder(body, folderId)

    const promises: Promise<void>[] = [
        putFolder(c.env.VAULT, userId, updatedFolder)
    ]

    if (!existing) {
        promises.push(addFolderToIndex(c.env.DB, userId, folderId))
    }

    await Promise.all(promises)

    return c.json(updatedFolder)
})

// --------------------------------------------------------------------------
// Delete Folder
// --------------------------------------------------------------------------

folders.delete('/api/folders/:id', async (c) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const folderId = c.req.param('id')

    await deleteFolder(c.env.VAULT, userId, folderId)
    await removeFolderFromIndex(c.env.DB, userId, folderId)

    return c.json({}, 200)
})

export default folders
