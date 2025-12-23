/**
 * Authentication API Module
 * 
 * Handles: Prelogin, Register, Token (password/refresh)
 */

import { Hono, Context } from 'hono'
import { sign, verify } from 'hono/jwt'
import type { Bindings, PreloginRequest, PreloginResponse, RegisterRequest, UserData } from '../types'
import { getUser, putUser } from '../storage/kv'
import { getSecret, createJwtMiddleware } from '../utils/auth'

type AppContext = Context<{ Bindings: Bindings }>

const auth = new Hono<{ Bindings: Bindings }>()

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

/** Build JWT payload for a user */
function buildJwtPayload(user: UserData, ttl: number) {
    return {
        sub: user.id,
        email: user.email,
        name: user.name,
        email_verified: true,
        stamp: user.securityStamp,
        exp: Math.floor(Date.now() / 1000) + ttl
    }
}

// --------------------------------------------------------------------------
// Prelogin
// --------------------------------------------------------------------------

const handlePrelogin = async (c: AppContext) => {
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

auth.post('/api/accounts/prelogin', handlePrelogin)
auth.post('/identity/accounts/prelogin', handlePrelogin)

// --------------------------------------------------------------------------
// Register
// --------------------------------------------------------------------------

const handleRegister = async (c: AppContext) => {
    const body: RegisterRequest = await c.req.json()
    const emailRaw = body.Email || body.email
    const masterHash = body.MasterPasswordHash || body.masterPasswordHash
    const key = body.Key || body.key
    const kdf = body.Kdf ?? body.kdf ?? 0
    const iterations = body.KdfIterations ?? body.kdfIterations ?? 100000
    const name = body.Name || body.name

    // RSA Keys extraction
    let pubKey: string | undefined
    let privKey: string | undefined
    if (body.keys) {
        pubKey = body.keys.publicKey
        privKey = body.keys.encryptedPrivateKey
    }

    if (!emailRaw || !masterHash || !key) {
        return errorResponse(c, 'Missing required fields (email, hash, key)')
    }
    const email = emailRaw.toLowerCase()

    const existing = await getUser(c.env.DB, email)
    if (existing) {
        return errorResponse(c, 'User already exists')
    }

    const now = new Date().toISOString()
    const newUser: UserData = {
        id: crypto.randomUUID(),
        email: email,
        masterPasswordHash: masterHash,
        masterPasswordHint: body.MasterPasswordHint || body.masterPasswordHint,
        key: key,
        kdf: kdf,
        kdfIterations: iterations,
        name: name,
        publicKey: pubKey,
        encryptedPrivateKey: privKey,
        securityStamp: crypto.randomUUID(),
        culture: 'en-US',
        createdAt: now,
        updatedAt: now
    }

    await putUser(c.env.DB, newUser)

    console.log(`Registered user: ${newUser.id}, KDF: ${newUser.kdf}`)
    return c.json({ id: newUser.id }, 200)
}

auth.post('/api/accounts/register', handleRegister)
auth.post('/identity/accounts/register', handleRegister)

// Email verification stub
auth.post('/identity/accounts/register/send-verification-email', (c) => c.json({ success: true }, 200))

// --------------------------------------------------------------------------
// Password Change (Protected)
// --------------------------------------------------------------------------

auth.post('/api/accounts/password', createJwtMiddleware, async (c) => {
    const jwtPayload = c.get('jwtPayload')
    const body = await c.req.json<any>()

    const user = await getUser(c.env.DB, jwtPayload.email)
    if (!user) {
        return errorResponse(c, 'User not found', 404)
    }

    // Verify current password
    const currentHash = body.MasterPasswordHash || body.masterPasswordHash
    if (user.masterPasswordHash !== currentHash) {
        return errorResponse(c, 'Invalid current password')
    }

    // Update password
    const newHash = body.NewMasterPasswordHash || body.newMasterPasswordHash
    const newKey = body.Key || body.key

    if (!newHash || !newKey) {
        return errorResponse(c, 'New password hash and key required')
    }

    user.masterPasswordHash = newHash
    user.key = newKey
    user.securityStamp = crypto.randomUUID()
    user.updatedAt = new Date().toISOString()

    await putUser(c.env.DB, user)

    return c.json({})
})

// --------------------------------------------------------------------------
// Token (Login / Refresh)
// --------------------------------------------------------------------------

auth.post('/identity/connect/token', async (c) => {
    try {
        const body = await c.req.parseBody()
        const secret = getSecret(c.env)

        // --- Refresh Token Flow ---
        if (body['grant_type'] === 'refresh_token') {
            const refreshToken = body['refresh_token'] as string
            try {
                const payload = await verify(refreshToken, secret)

                const user = await getUser(c.env.DB, payload.email as string)
                if (!user) throw new Error('User deleted')

                const newAccessToken = await sign(buildJwtPayload(user, ACCESS_TOKEN_TTL), secret)
                const newRefreshToken = await sign(buildJwtPayload(user, REFRESH_TOKEN_TTL), secret)

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

        // URL Encoding Check: ' ' vs '+'
        let passwordValid = user.masterPasswordHash === password
        if (!passwordValid && password.includes(' ')) {
            const fixedPassword = password.replace(/ /g, '+')
            if (user.masterPasswordHash === fixedPassword) {
                passwordValid = true
            }
        }

        if (!passwordValid) {
            console.log(`Login failed: hash mismatch`)
            return c.json({ error: 'invalid_grant', error_description: 'Invalid username or password' }, 400)
        }

        const accessToken = await sign(buildJwtPayload(user, ACCESS_TOKEN_TTL), secret)
        const refreshToken = await sign(buildJwtPayload(user, REFRESH_TOKEN_TTL), secret)

        return c.json(buildTokenResponse(user, accessToken, refreshToken))
    } catch (e) {
        console.error('Token Error:', e)
        return c.json({ error: 'invalid_request' }, 400)
    }
})

export default auth
