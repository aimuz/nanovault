/**
 * Authentication Handlers Module
 * 
 * Exports handler functions for: Prelogin, Register, Token, Email/Password change
 */

import { Context } from 'hono'
import { sign, verify } from 'hono/jwt'
import type { Bindings, PreloginRequest, PreloginResponse, UserData, FinishRegisterRequest, Device } from '../types'
import { getUser, putUser, getDevice, putDevice } from '../storage/kv'
import { getSecret } from '../utils/auth'
import { isPushEnabled, registerDevice } from './push'
import { sendMail } from '../utils/mail'

type AppContext = Context<{ Bindings: Bindings }>

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const ACCESS_TOKEN_TTL = 3600           // 1 hour in seconds
const REFRESH_TOKEN_TTL = 7 * 24 * 3600 // 7 days in seconds

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Bitwarden-style error response */
export const errorResponse = (c: AppContext, message: string, statusCode: 400 | 401 | 403 | 404 | 500 = 400) => {
    return c.json({
        message: message,
        validationErrors: { '': [message] },
        errorModel: { message: message, validationErrors: { '': [message] } },
        object: 'error'
    }, statusCode)
}

/** 
 * Server-side hash of masterPasswordHash for storage.
 * Uses securityStamp as salt to prevent rainbow table attacks.
 */
async function hashPassword(masterPasswordHash: string, salt: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(salt + masterPasswordHash)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Build OAuth2 token response */
function buildTokenResponse(
    user: UserData,
    accessToken: string,
    refreshToken: string
) {
    return {
        access_token: accessToken,
        expires_in: ACCESS_TOKEN_TTL,
        token_type: 'Bearer',
        refresh_token: refreshToken,
        key: user.key,
        privateKey: user.encryptedPrivateKey,
        kdf: user.kdf,
        kdfIterations: user.kdfIterations,
        kdfMemory: user.kdfMemory,
        kdfParallelism: user.kdfParallelism,
        userDecryptionOptions: {
            hasMasterPassword: true,
            object: 'userDecryptionOptions'
        }
    }
}

type TokenType = 'access' | 'refresh'

function buildJwtPayload(user: UserData, ttl: number, tokenType: TokenType) {
    return {
        sub: user.id,
        email: user.email,
        name: user.name,
        email_verified: true,
        stamp: user.securityStamp,
        token_type: tokenType,
        exp: Math.floor(Date.now() / 1000) + ttl
    }
}

// --------------------------------------------------------------------------
// Prelogin Handler
// --------------------------------------------------------------------------

export const handlePrelogin = async (c: AppContext) => {
    try {
        const body: PreloginRequest = await c.req.json()
        const emailIn = body.Email || body.email
        if (!emailIn) {
            return errorResponse(c, 'Email required')
        }

        const user = await getUser(c.env.DB, emailIn)

        if (user) {
            const response: PreloginResponse = {
                kdf: user.kdf,
                kdfIterations: user.kdfIterations,
                kdfMemory: user.kdfMemory,
                kdfParallelism: user.kdfParallelism
            }
            return c.json(response)
        }

        // Default for unknown users (PBKDF2)
        return c.json<PreloginResponse>({
            kdf: 0,
            kdfIterations: 100000
        })
    } catch {
        return errorResponse(c, 'Invalid request')
    }
}

// --------------------------------------------------------------------------
// Legacy Register Handler
// --------------------------------------------------------------------------

export const legacyRegisterHandler = (c: AppContext) => {
    return errorResponse(c, 'Registration via this endpoint is disabled. Please use the email verification flow: 1) POST /identity/accounts/register/send-verification-email 2) POST /identity/accounts/register/finish')
}

// --------------------------------------------------------------------------
// Register Finish Handler
// --------------------------------------------------------------------------

export const handleRegisterFinish = async (c: AppContext) => {
    const body = await c.req.json<FinishRegisterRequest>()

    const email = body.email?.toLowerCase()
    const masterHash = body.masterPasswordHash
    const key = body.userSymmetricKey
    const kdf = body.kdf ?? 0
    const iterations = body.kdfIterations ?? 600000
    const hint = body.masterPasswordHint
    const emailToken = body.emailVerificationToken

    const pubKey = body.userAsymmetricKeys?.publicKey
    const privKey = body.userAsymmetricKeys?.encryptedPrivateKey

    if (!email || !masterHash || !key) {
        return errorResponse(c, 'Missing required fields (email, masterPasswordHash, userSymmetricKey)')
    }

    if (!emailToken) {
        return errorResponse(c, 'Email verification token required')
    }

    let tokenName: string | undefined
    try {
        const secret = getSecret(c.env)
        const payload = await verify(emailToken, secret)

        if (payload.type !== 'registration') {
            return errorResponse(c, 'Invalid verification token type')
        }
        if ((payload.email as string).toLowerCase() !== email) {
            return errorResponse(c, 'Token email mismatch')
        }
        tokenName = payload.name as string | undefined
    } catch {
        return errorResponse(c, 'Invalid or expired verification token')
    }

    const existing = await getUser(c.env.DB, email)
    if (existing) {
        return errorResponse(c, 'User already exists')
    }

    const securityStamp = crypto.randomUUID()
    const serverHash = await hashPassword(masterHash, securityStamp)

    const now = new Date().toISOString()
    const newUser: UserData = {
        id: crypto.randomUUID(),
        email: email,
        masterPasswordHash: serverHash,
        masterPasswordHint: hint,
        key: key,
        kdf: kdf,
        kdfIterations: iterations,
        name: tokenName || "",
        publicKey: pubKey,
        encryptedPrivateKey: privKey,
        securityStamp: securityStamp,
        culture: 'en-US',
        emailVerified: true,
        createdAt: now,
        updatedAt: now
    }

    await putUser(c.env.DB, newUser)

    console.log(`Registered user (finish): ${newUser.id}, KDF: ${newUser.kdf}, verified: ${newUser.emailVerified}`)
    return c.json({ id: newUser.id }, 200)
}

// --------------------------------------------------------------------------
// Send Verification Email Handler
// --------------------------------------------------------------------------

export const handleSendVerificationEmail = async (c: AppContext) => {
    const body = await c.req.json<any>()
    const email = (body.Email || body.email || '').toLowerCase()
    const baseUrl = new URL(c.req.url).origin

    if (!email) {
        return c.json({ success: true }, 200)
    }

    const existing = await getUser(c.env.DB, email)
    if (existing) {
        console.log(`[NanoVault] Registration attempt for existing email: ${email}`)
        return c.json({ success: true }, 200)
    }

    const secret = getSecret(c.env)
    const name = body.Name || body.name || ''

    const registrationToken = await sign({
        email: email,
        name: name,
        type: 'registration',
        exp: Math.floor(Date.now() / 1000) + 24 * 3600
    }, secret)

    const registerUrl = `${baseUrl}/#/finish-signup/?email=${encodeURIComponent(email)}&token=${encodeURIComponent(registrationToken)}`

    // Send actual email if Resend is configured
    if (c.env.RESEND_API_KEY) {
        await sendMail(
            c.env,
            email,
            'Verify your email to register on Nanovault',
            `
            <h1>Welcome to Nanovault</h1>
            <p>Please click the link below to complete your registration:</p>
            <p><a href="${registerUrl}">Complete Registration</a></p>
            <p>If the link doesn't work, copy and paste this URL into your browser:</p>
            <pre>${registerUrl}</pre>
            <p>This link will expire in 24 hours.</p>
            `
        )
    }

    console.log(`[NanoVault] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`[NanoVault] Registration request for: ${email}`)
    console.log(`[NanoVault] Complete registration at:`)
    console.log(`[NanoVault] ${registerUrl}`)
    console.log(`[NanoVault] Token valid for 24 hours`)
    console.log(`[NanoVault] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

    return c.json({ success: true }, 200)
}

// --------------------------------------------------------------------------
// Email Token Handler (request email change)
// --------------------------------------------------------------------------

export const handleEmailToken = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const body = await c.req.json<any>()

    const newEmail = (body.newEmail || '').toLowerCase()
    const passwordHash = body.masterPasswordHash

    if (!newEmail || !passwordHash) {
        return errorResponse(c, 'Missing newEmail or masterPasswordHash')
    }

    const user = await getUser(c.env.DB, payload.email)
    if (!user) {
        return errorResponse(c, 'User not found', 404)
    }

    const incomingHash = await hashPassword(passwordHash, user.securityStamp)
    if (user.masterPasswordHash !== incomingHash) {
        return errorResponse(c, 'Invalid password')
    }

    const existing = await getUser(c.env.DB, newEmail)
    if (existing) {
        return errorResponse(c, 'Email already in use')
    }

    const secret = getSecret(c.env)
    const emailChangeToken = await sign({
        userId: user.id,
        oldEmail: user.email,
        newEmail: newEmail,
        type: 'email_change',
        exp: Math.floor(Date.now() / 1000) + 24 * 3600
    }, secret)

    const baseUrl = new URL(c.req.url).origin

    // Send actual email if Resend is configured
    if (c.env.RESEND_API_KEY) {
        await sendMail(
            c.env,
            newEmail,
            'Verify your new email address for Nanovault',
            `
            <h1>Change Email Request</h1>
            <p>You requested to change your email to <b>${newEmail}</b>.</p>
            <p>Please use the following token in your Bitwarden client to complete the change:</p>
            <pre style="background: #f4f4f4; padding: 10px; border-radius: 5px;">${emailChangeToken}</pre>
            <p>This token will expire in 24 hours.</p>
            `
        )
    }

    console.log(`[NanoVault] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`[NanoVault] Email change request for: ${user.email} -> ${newEmail}`)
    console.log(`[NanoVault] Token: ${emailChangeToken}`)
    console.log(`[NanoVault] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

    return c.json({}, 200)
}

// --------------------------------------------------------------------------
// Email Change Handler (complete email change)
// --------------------------------------------------------------------------

export const handleEmailChange = async (c: AppContext) => {
    const payload = c.get('jwtPayload')
    const body = await c.req.json<any>()

    const token = body.token
    const newEmail = (body.newEmail || '').toLowerCase()
    const masterPasswordHash = body.masterPasswordHash
    const newMasterPasswordHash = body.newMasterPasswordHash
    const newKey = body.key

    if (!token || !newEmail || !masterPasswordHash || !newMasterPasswordHash || !newKey) {
        return errorResponse(c, 'Missing required fields')
    }

    const secret = getSecret(c.env)
    let tokenPayload
    try {
        tokenPayload = await verify(token, secret)
        if (tokenPayload.type !== 'email_change') {
            return errorResponse(c, 'Invalid token type')
        }
    } catch {
        return errorResponse(c, 'Invalid or expired token')
    }

    const user = await getUser(c.env.DB, payload.email)
    if (!user || user.id !== tokenPayload.userId) {
        return errorResponse(c, 'User mismatch', 401)
    }

    const incomingHash = await hashPassword(masterPasswordHash, user.securityStamp)
    if (user.masterPasswordHash !== incomingHash) {
        return errorResponse(c, 'Invalid password')
    }

    const existing = await getUser(c.env.DB, newEmail)
    if (existing) {
        return errorResponse(c, 'Email already in use')
    }

    const newSecurityStamp = crypto.randomUUID()
    const newServerHash = await hashPassword(newMasterPasswordHash, newSecurityStamp)

    const updatedUser: UserData = {
        ...user,
        email: newEmail,
        masterPasswordHash: newServerHash,
        key: newKey,
        securityStamp: newSecurityStamp,
        updatedAt: new Date().toISOString()
    }

    await c.env.DB.delete(`user:${user.email}`)
    await putUser(c.env.DB, updatedUser)

    console.log(`[NanoVault] Email changed: ${user.email} -> ${newEmail}`)
    return c.json({}, 200)
}

// --------------------------------------------------------------------------
// Password Change Handler
// --------------------------------------------------------------------------

export const handlePasswordChange = async (c: AppContext) => {
    const jwtPayload = c.get('jwtPayload')
    const body = await c.req.json<any>()

    const user = await getUser(c.env.DB, jwtPayload.email)
    if (!user) {
        return errorResponse(c, 'User not found', 404)
    }

    const currentHash = body.MasterPasswordHash || body.masterPasswordHash
    const incomingHash = await hashPassword(currentHash, user.securityStamp)
    if (user.masterPasswordHash !== incomingHash) {
        return errorResponse(c, 'Invalid current password')
    }

    const newHash = body.NewMasterPasswordHash || body.newMasterPasswordHash
    const newKey = body.Key || body.key

    if (!newHash || !newKey) {
        return errorResponse(c, 'New password hash and key required')
    }

    const newSecurityStamp = crypto.randomUUID()
    user.masterPasswordHash = await hashPassword(newHash, newSecurityStamp)
    user.key = newKey
    user.securityStamp = newSecurityStamp
    user.updatedAt = new Date().toISOString()

    await putUser(c.env.DB, user)

    return c.json({})
}

// --------------------------------------------------------------------------
// Token Handler (login / refresh)
// --------------------------------------------------------------------------

export const handleToken = async (c: AppContext) => {
    try {
        const body = await c.req.parseBody()
        const secret = getSecret(c.env)

        // --- Refresh Token Flow ---
        if (body['grant_type'] === 'refresh_token') {
            const refreshToken = body['refresh_token'] as string
            try {
                const payload = await verify(refreshToken, secret)

                if (payload.token_type !== 'refresh') {
                    return c.json({ error: 'invalid_grant', error_description: 'Invalid token type' }, 400)
                }

                const user = await getUser(c.env.DB, payload.email as string)
                if (!user) throw new Error('User deleted')

                if (payload.stamp !== user.securityStamp) {
                    return c.json({ error: 'invalid_grant', error_description: 'Token has been revoked' }, 400)
                }

                const newAccessToken = await sign(buildJwtPayload(user, ACCESS_TOKEN_TTL, 'access'), secret)
                const newRefreshToken = await sign(buildJwtPayload(user, REFRESH_TOKEN_TTL, 'refresh'), secret)

                return c.json(buildTokenResponse(user, newAccessToken, newRefreshToken))
            } catch {
                return c.json({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' }, 400)
            }
        }

        // --- Password Flow ---
        if (body['grant_type'] !== 'password') {
            return c.json({ error: 'unsupported_grant_type', error_description: 'Supported: password, refresh_token' }, 400)
        }

        const emailInput = body['username'] as string
        if (!emailInput) return c.json({ error: 'invalid_grant' }, 400)

        const email = emailInput.toLowerCase()
        const password = body['password'] as string

        const user = await getUser(c.env.DB, email)
        if (!user) {
            console.log(`Login failed: user not found`)
            return c.json({ error: 'invalid_grant', error_description: 'Invalid username or password' }, 400)
        }

        let passwordToCheck = password
        if (password.includes(' ')) {
            passwordToCheck = password.replace(/ /g, '+')
        }

        const incomingServerHash = await hashPassword(passwordToCheck, user.securityStamp)
        if (user.masterPasswordHash !== incomingServerHash) {
            console.log(`Login failed: hash mismatch`)
            return c.json({ error: 'invalid_grant', error_description: 'Invalid username or password' }, 400)
        }

        const accessToken = await sign(buildJwtPayload(user, ACCESS_TOKEN_TTL, 'access'), secret)
        const refreshToken = await sign(buildJwtPayload(user, REFRESH_TOKEN_TTL, 'refresh'), secret)

        // Capture device info for push notifications
        const deviceIdentifier = body['deviceIdentifier'] as string
        const deviceName = body['deviceName'] as string
        const deviceType = parseInt(body['deviceType'] as string) || 0
        const devicePushToken = body['devicePushToken'] as string

        if (deviceIdentifier) {
            const now = new Date().toISOString()
            const device: Device = {
                id: crypto.randomUUID(),
                userId: user.id,
                name: deviceName || 'Unknown Device',
                type: deviceType,
                identifier: deviceIdentifier,
                pushToken: devicePushToken,
                createdAt: now,
                updatedAt: now
            }

            const existingDevice = await getDevice(c.env.DB, deviceIdentifier)
            if (existingDevice) {
                device.id = existingDevice.id
                device.createdAt = existingDevice.createdAt
            }

            if (devicePushToken && isPushEnabled(c.env)) {
                const pushUuid = await registerDevice(c.env, user.id, device)
                if (pushUuid) {
                    device.pushUuid = pushUuid
                }
            }

            await putDevice(c.env.DB, device)
        }

        return c.json(buildTokenResponse(user, accessToken, refreshToken))
    } catch (e) {
        console.error('Token Error:', e)
        return c.json({ error: 'invalid_request' }, 400)
    }
}
