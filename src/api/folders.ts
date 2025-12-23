/**
 * Folders Handlers Module
 * 
 * Exports handler functions for: CRUD operations for folders
 */

import { Context } from 'hono'
import type { Bindings, Folder } from '../types'
import { addFolderToIndex, removeFolderFromIndex } from '../storage/kv'
import { getFolder, putFolder, deleteFolder } from '../storage/s3'
import { errorResponse } from './auth'
import { notifyFolderCreate, notifyFolderUpdate, notifyFolderDelete } from './push'

type AppContext = Context<{ Bindings: Bindings }>

// --------------------------------------------------------------------------
// Helper: Build folder from request body
// --------------------------------------------------------------------------

const buildFolder = (body: Record<string, any>, id?: string): Folder => {
    return {
        id: id ?? body.Id ?? body.id ?? crypto.randomUUID(),
        name: body.Name ?? body.name ?? '',
        revisionDate: new Date().toISOString(),
        object: 'folder'
    }
}

// --------------------------------------------------------------------------
// Create Folder Handler
// --------------------------------------------------------------------------

export const handleCreate = async (c: AppContext) => {
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

    notifyFolderCreate(c.env, userId, newFolder.id, newFolder.revisionDate)

    return c.json(newFolder)
}

// --------------------------------------------------------------------------
// Get Folder Handler
// --------------------------------------------------------------------------

export const handleGet = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const folderId = c.req.param('id')

    const folder = await getFolder(c.env.VAULT, userId, folderId)
    if (!folder) {
        return errorResponse(c, 'Folder not found', 404)
    }

    return c.json(folder)
}

// --------------------------------------------------------------------------
// Update Folder Handler
// --------------------------------------------------------------------------

export const handleUpdate = async (c: AppContext) => {
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

    notifyFolderUpdate(c.env, userId, updatedFolder.id, updatedFolder.revisionDate)

    return c.json(updatedFolder)
}

// --------------------------------------------------------------------------
// Delete Folder Handler
// --------------------------------------------------------------------------

export const handleDelete = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const userId = payload.sub as string
    const folderId = c.req.param('id')

    await deleteFolder(c.env.VAULT, userId, folderId)
    await removeFolderFromIndex(c.env.DB, userId, folderId)

    notifyFolderDelete(c.env, userId, folderId)

    return c.json({}, 200)
}
