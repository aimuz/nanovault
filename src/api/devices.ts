/**
 * Devices Handlers Module
 * 
 * Exports handler functions for device management for push notifications.
 */

import { Context } from 'hono'
import type { Bindings } from '../types'
import { getDevice, getDevicesByUser, putDevice, deleteDevice as deleteDeviceKV } from '../storage/kv'
import { deleteDevice as deletePushDevice, registerDevice, isPushEnabled } from './push'
import { errorResponse } from './auth'

type AppContext = Context<{ Bindings: Bindings }>

// --------------------------------------------------------------------------
// Device List Handler
// --------------------------------------------------------------------------

export const handleList = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const userDevices = await getDevicesByUser(c.env.DB, payload.sub)

    return c.json({
        data: userDevices.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
            identifier: d.identifier,
            creationDate: d.createdAt,
        })),
        continuationToken: null,
        object: 'list',
    })
}

// --------------------------------------------------------------------------
// Known Device Check Handler
// --------------------------------------------------------------------------

export const handleKnownDevice = async (c: AppContext) => {
    return c.json(true)
}

// --------------------------------------------------------------------------
// Delete Device Handler
// --------------------------------------------------------------------------

export const handleDelete = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const deviceId = c.req.param('id')

    const userDevices = await getDevicesByUser(c.env.DB, payload.sub)
    const device = userDevices.find(d => d.id === deviceId)

    if (!device) {
        return errorResponse(c, 'Device not found', 404)
    }

    if (device.pushUuid && isPushEnabled(c.env)) {
        await deletePushDevice(c.env, device.pushUuid)
    }

    await deleteDeviceKV(c.env.DB, device)

    return c.json({}, 200)
}

// --------------------------------------------------------------------------
// Update Push Token Handler
// --------------------------------------------------------------------------

export const handleUpdateToken = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const identifier = c.req.param('identifier')
    const body = await c.req.json<any>()

    const pushToken = body.pushToken

    if (!pushToken) {
        return errorResponse(c, 'Missing pushToken')
    }

    let device = await getDevice(c.env.DB, identifier)

    if (!device || device.userId !== payload.sub) {
        return errorResponse(c, 'Device not found', 404)
    }

    device.pushToken = pushToken
    device.updatedAt = new Date().toISOString()

    if (isPushEnabled(c.env)) {
        const pushUuid = await registerDevice(c.env, payload.sub, device)
        if (pushUuid) {
            device.pushUuid = pushUuid
        }
    }

    await putDevice(c.env.DB, device)

    return c.json({}, 200)
}

// --------------------------------------------------------------------------
// Clear Push Token Handler
// --------------------------------------------------------------------------

export const handleClearToken = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const identifier = c.req.param('identifier')

    const device = await getDevice(c.env.DB, identifier)

    if (!device || device.userId !== payload.sub) {
        return errorResponse(c, 'Device not found', 404)
    }

    if (device.pushUuid && isPushEnabled(c.env)) {
        await deletePushDevice(c.env, device.pushUuid)
    }

    device.pushToken = undefined
    device.pushUuid = undefined
    device.updatedAt = new Date().toISOString()

    await putDevice(c.env.DB, device)

    return c.json({}, 200)
}
