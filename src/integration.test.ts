/**
 * API Compatibility Integration Tests
 *
 * These tests simulate real Bitwarden client requests to verify API compatibility.
 * Unlike mocked unit tests, these test the full request/response cycle.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import app from './index'

// =============================================================================
// Test Environment - Uses real Hono test helpers with in-memory storage
// =============================================================================

// In-memory storage for integration tests
class InMemoryKV {
    private store = new Map<string, string>()

    async get(key: string): Promise<string | null> {
        return this.store.get(key) ?? null
    }

    async put(key: string, value: string): Promise<void> {
        this.store.set(key, value)
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key)
    }

    clear() {
        this.store.clear()
    }
}

class InMemoryR2 {
    private store = new Map<string, any>()

    async get(key: string): Promise<{ json: () => Promise<any> } | null> {
        const value = this.store.get(key)
        if (!value) return null
        return { json: () => Promise.resolve(value) }
    }

    async put(key: string, body: string): Promise<void> {
        this.store.set(key, JSON.parse(body))
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key)
    }

    async list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }> {
        const prefix = options?.prefix ?? ''
        const objects = Array.from(this.store.keys())
            .filter(k => k.startsWith(prefix))
            .map(key => ({ key }))
        return { objects }
    }

    clear() {
        this.store.clear()
    }
}

const createTestEnv = () => ({
    DB: new InMemoryKV(),
    VAULT: new InMemoryR2(),
    JWT_SECRET: 'integration-test-secret-key-32chars!'
})

// =============================================================================
// Auth Flow Integration Tests
// =============================================================================

describe('Integration: Auth Flow', () => {
    let env: ReturnType<typeof createTestEnv>

    beforeEach(() => {
        env = createTestEnv()
    })

    describe('Prelogin', () => {
        const testCases = [
            {
                name: 'returns default PBKDF2 KDF for new user',
                email: 'newuser@example.com',
                setup: async () => { },
                expected: { kdf: 0, kdfIterations: 100000 }
            },
            {
                name: 'returns stored KDF settings for existing user',
                email: 'existing@example.com',
                setup: async () => {
                    await env.DB.put('user:existing@example.com', JSON.stringify({
                        id: 'user-1',
                        email: 'existing@example.com',
                        kdf: 1,
                        kdfIterations: 3,
                        kdfMemory: 64,
                        kdfParallelism: 4
                    }))
                },
                expected: { kdf: 1, kdfIterations: 3, kdfMemory: 64, kdfParallelism: 4 }
            }
        ]

        testCases.forEach(({ name, email, setup, expected }) => {
            it(name, async () => {
                await setup()

                const res = await app.request('/api/accounts/prelogin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                }, env)

                expect(res.status).toBe(200)
                const data = await res.json() as any
                expect(data.kdf).toBe(expected.kdf)
                expect(data.kdfIterations).toBe(expected.kdfIterations)
                if (expected.kdfMemory) expect(data.kdfMemory).toBe(expected.kdfMemory)
            })
        })

        it('accepts PascalCase Email field (client compatibility)', async () => {
            const res = await app.request('/identity/accounts/prelogin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ Email: 'test@example.com' })
            }, env)

            expect(res.status).toBe(200)
        })

        it('returns 400 for missing email', async () => {
            const res = await app.request('/api/accounts/prelogin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            }, env)

            expect(res.status).toBe(400)
        })
    })

    describe('Register', () => {
        it('creates user with camelCase request fields', async () => {
            const res = await app.request('/api/accounts/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'newuser@example.com',
                    masterPasswordHash: 'hash123abc',
                    key: 'encryptedMasterKey123',
                    kdf: 0,
                    kdfIterations: 100000
                })
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any

            // Verify response structure
            expect(data.id).toBeDefined()
            expect(typeof data.id).toBe('string')
        })

        it('creates user with PascalCase request fields (client compat)', async () => {
            const res = await app.request('/api/accounts/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    Email: 'pascal@example.com',
                    MasterPasswordHash: 'hash123',
                    Key: 'encryptedKey',
                    Kdf: 1,
                    KdfIterations: 600000,
                    Keys: {
                        PublicKey: 'publicKey123',
                        EncryptedPrivateKey: 'privateKey123'
                    }
                })
            }, env)

            expect(res.status).toBe(200)
        })

        it('rejects duplicate email registration', async () => {
            // First registration
            await app.request('/api/accounts/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'dup@example.com',
                    masterPasswordHash: 'hash1',
                    key: 'key1'
                })
            }, env)

            // Second registration with same email
            const res = await app.request('/api/accounts/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'dup@example.com',
                    masterPasswordHash: 'hash2',
                    key: 'key2'
                })
            }, env)

            expect(res.status).toBe(400)
            const data = await res.json() as any
            expect(data.message).toMatch(/exists/i)
        })

        const missingFieldCases = [
            { name: 'missing email', body: { masterPasswordHash: 'h', key: 'k' } },
            { name: 'missing masterPasswordHash', body: { email: 'e@e.com', key: 'k' } },
            { name: 'missing key', body: { email: 'e@e.com', masterPasswordHash: 'h' } }
        ]

        missingFieldCases.forEach(({ name, body }) => {
            it(`rejects ${name}`, async () => {
                const res = await app.request('/api/accounts/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }, env)

                expect(res.status).toBe(400)
            })
        })
    })

    describe('Token (Login)', () => {
        beforeEach(async () => {
            // Pre-register a test user
            await app.request('/api/accounts/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'login@example.com',
                    masterPasswordHash: 'correctHash123',
                    key: 'userEncryptionKey123',
                    kdf: 0,
                    kdfIterations: 100000
                })
            }, env)
        })

        it('returns OAuth2-compliant token response for valid credentials', async () => {
            const res = await app.request('/identity/connect/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'password',
                    username: 'login@example.com',
                    password: 'correctHash123'
                }).toString()
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any

            // OAuth2 required fields
            expect(data.access_token).toBeDefined()
            expect(data.refresh_token).toBeDefined()
            expect(data.token_type).toBe('Bearer')
            expect(data.expires_in).toBeDefined()

            // Bitwarden-specific fields
            expect(data.key).toBe('userEncryptionKey123')
            expect(data.kdf).toBe(0)
            expect(data.kdfIterations).toBe(100000)
            expect(data.userDecryptionOptions).toBeDefined()
            expect(data.userDecryptionOptions.hasMasterPassword).toBe(true)
        })

        it('returns error for invalid password', async () => {
            const res = await app.request('/identity/connect/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'password',
                    username: 'login@example.com',
                    password: 'wrongPassword'
                }).toString()
            }, env)

            expect(res.status).toBe(400)
            const data = await res.json() as any
            expect(data.error).toBe('invalid_grant')
        })

        it('returns error for non-existent user', async () => {
            const res = await app.request('/identity/connect/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'password',
                    username: 'nobody@example.com',
                    password: 'anypass'
                }).toString()
            }, env)

            expect(res.status).toBe(400)
            const data = await res.json() as any
            expect(data.error).toBe('invalid_grant')
        })

        it('rejects unsupported grant_type', async () => {
            const res = await app.request('/identity/connect/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'client_credentials'
                }).toString()
            }, env)

            expect(res.status).toBe(400)
            const data = await res.json() as any
            expect(data.error).toBe('unsupported_grant_type')
        })
    })

    describe('Token Refresh', () => {
        let refreshToken: string

        beforeEach(async () => {
            // Register and login to get tokens
            await app.request('/api/accounts/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'refresh@example.com',
                    masterPasswordHash: 'hash123',
                    key: 'key123'
                })
            }, env)

            const loginRes = await app.request('/identity/connect/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'password',
                    username: 'refresh@example.com',
                    password: 'hash123'
                }).toString()
            }, env)

            const loginData = await loginRes.json() as any
            refreshToken = loginData.refresh_token
        })

        it('issues new access_token with valid refresh_token', async () => {
            const res = await app.request('/identity/connect/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken
                }).toString()
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.access_token).toBeDefined()
            expect(data.refresh_token).toBeDefined()
            expect(data.token_type).toBe('Bearer')
        })

        it('rejects invalid refresh_token', async () => {
            const res = await app.request('/identity/connect/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: 'invalid-token-here'
                }).toString()
            }, env)

            expect(res.status).toBe(400)
            const data = await res.json() as any
            expect(data.error).toBe('invalid_grant')
        })
    })
})

// =============================================================================
// Vault Operations Integration Tests
// =============================================================================

describe('Integration: Vault Operations', () => {
    let env: ReturnType<typeof createTestEnv>
    let accessToken: string
    let userId: string

    beforeEach(async () => {
        env = createTestEnv()

        // Register and login
        const regRes = await app.request('/api/accounts/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'vault@example.com',
                masterPasswordHash: 'vaultHash',
                key: 'vaultKey'
            })
        }, env)
        const regData = await regRes.json() as any
        userId = regData.id

        const loginRes = await app.request('/identity/connect/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'password',
                username: 'vault@example.com',
                password: 'vaultHash'
            }).toString()
        }, env)
        const loginData = await loginRes.json() as any
        accessToken = loginData.access_token
    })

    describe('Cipher CRUD', () => {
        it('creates a Login cipher (type=1)', async () => {
            const res = await app.request('/api/ciphers', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 1,
                    name: 'My Login',
                    login: {
                        username: 'testuser',
                        password: 'testpass',
                        uris: [{ uri: 'https://example.com' }]
                    }
                })
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any

            // Verify response structure
            expect(data.id).toBeDefined()
            expect(data.type).toBe(1)
            expect(data.name).toBe('My Login')
            expect(data.object).toBe('cipher')
            expect(data.revisionDate).toBeDefined()
            expect(data.creationDate).toBeDefined()
            expect(data.login.username).toBe('testuser')
        })

        it('creates a SecureNote cipher (type=2)', async () => {
            const res = await app.request('/api/ciphers', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 2,
                    name: 'My Note',
                    notes: 'Secret note content',
                    secureNote: { type: 0 }
                })
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.type).toBe(2)
        })

        it('creates a Card cipher (type=3)', async () => {
            const res = await app.request('/api/ciphers', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 3,
                    name: 'My Card',
                    card: {
                        cardholderName: 'John Doe',
                        number: '4111111111111111',
                        expMonth: '12',
                        expYear: '2030',
                        code: '123'
                    }
                })
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.type).toBe(3)
        })

        it('creates an SSHKey cipher (type=5)', async () => {
            const res = await app.request('/api/ciphers', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 5,
                    name: 'My SSH Key',
                    sshKey: {
                        privateKey: 'encrypted-private-key',
                        publicKey: 'ssh-rsa AAAA...',
                        fingerprint: 'SHA256:abcd1234'
                    }
                })
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.type).toBe(5)
            expect(data.sshKey).toBeDefined()
            expect(data.sshKey.publicKey).toBe('ssh-rsa AAAA...')
        })

        it('includes new cipher fields (archivedDate, key, passwordHistory, edit, viewPassword)', async () => {
            const res = await app.request('/api/ciphers', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 1,
                    name: 'Full Cipher',
                    login: { username: 'test' },
                    key: 'cipher-encryption-key',
                    passwordHistory: [
                        { password: 'oldpass1', lastUsedDate: '2024-01-01T00:00:00Z' }
                    ]
                })
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any

            // New fields should be present
            expect(data.edit).toBe(true)
            expect(data.viewPassword).toBe(true)
            expect(data.organizationUseTotp).toBe(false)
            expect(data.archivedDate).toBeNull()
            expect(data.key).toBe('cipher-encryption-key')
            expect(data.passwordHistory).toHaveLength(1)
        })

        it('gets a cipher by ID', async () => {
            // Create first
            const createRes = await app.request('/api/ciphers', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ type: 1, name: 'TestCipher', login: {} })
            }, env)
            const created = await createRes.json() as any

            // Get
            const res = await app.request(`/api/ciphers/${created.id}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.id).toBe(created.id)
            expect(data.name).toBe('TestCipher')
        })

        it('updates a cipher', async () => {
            // Create
            const createRes = await app.request('/api/ciphers', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ type: 1, name: 'Original', login: {} })
            }, env)
            const created = await createRes.json() as any

            // Update
            const res = await app.request(`/api/ciphers/${created.id}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 1,
                    name: 'Updated Name',
                    login: { username: 'newuser' }
                })
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.name).toBe('Updated Name')
            expect(data.login.username).toBe('newuser')
        })

        it('soft deletes a cipher (move to trash)', async () => {
            // Create
            const createRes = await app.request('/api/ciphers', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ type: 1, name: 'ToTrash', login: {} })
            }, env)
            const created = await createRes.json() as any

            // Soft delete
            const res = await app.request(`/api/ciphers/${created.id}/delete`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.deletedDate).toBeDefined()
            expect(data.deletedDate).not.toBeNull()
        })

        it('restores a cipher from trash', async () => {
            // Create
            const createRes = await app.request('/api/ciphers', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ type: 1, name: 'ToRestore', login: {} })
            }, env)
            const created = await createRes.json() as any

            // Soft delete first
            await app.request(`/api/ciphers/${created.id}/delete`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }, env)

            // Restore
            const res = await app.request(`/api/ciphers/${created.id}/restore`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.deletedDate).toBeNull()
        })

        it('returns 401 without authorization', async () => {
            const res = await app.request('/api/ciphers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 1, name: 'Unauth' })
            }, env)

            expect(res.status).toBe(401)
        })
    })

    describe('Folder CRUD', () => {
        it('creates a folder', async () => {
            const res = await app.request('/api/folders', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: 'Work' })
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.id).toBeDefined()
            expect(data.name).toBe('Work')
            expect(data.object).toBe('folder')
            expect(data.revisionDate).toBeDefined()
        })

        it('creates folder with PascalCase Name field', async () => {
            const res = await app.request('/api/folders', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ Name: 'Personal' })
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.name).toBe('Personal')
        })

        it('gets a folder by ID', async () => {
            const createRes = await app.request('/api/folders', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: 'GetTest' })
            }, env)
            const created = await createRes.json() as any

            const res = await app.request(`/api/folders/${created.id}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.id).toBe(created.id)
            expect(data.name).toBe('GetTest')
        })

        it('updates a folder', async () => {
            const createRes = await app.request('/api/folders', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: 'OldName' })
            }, env)
            const created = await createRes.json() as any

            const res = await app.request(`/api/folders/${created.id}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: 'NewName' })
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.name).toBe('NewName')
        })

        it('deletes a folder', async () => {
            const createRes = await app.request('/api/folders', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: 'ToDelete' })
            }, env)
            const created = await createRes.json() as any

            const res = await app.request(`/api/folders/${created.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }, env)

            expect(res.status).toBe(200)
        })

        it('rejects folder without name', async () => {
            const res = await app.request('/api/folders', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            }, env)

            expect(res.status).toBe(400)
        })
    })

    describe('Import', () => {
        it('imports multiple ciphers and folders', async () => {
            const res = await app.request('/api/ciphers/import', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ciphers: [
                        { type: 1, name: 'Login 1', login: { username: 'u1' } },
                        { type: 2, name: 'Note 1', secureNote: { type: 0 } },
                        { type: 3, name: 'Card 1', card: { number: '4111' } }
                    ],
                    folders: [
                        { name: 'Folder A' },
                        { name: 'Folder B' }
                    ]
                })
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.success).toBe(true)
            expect(data.ciphers).toHaveLength(3)
            expect(data.folders).toHaveLength(2)

            // Verify each cipher has required fields
            for (const cipher of data.ciphers) {
                expect(cipher.id).toBeDefined()
                expect(cipher.revisionDate).toBeDefined()
                expect(cipher.object).toBe('cipher')
            }
        })

        it('handles PascalCase import fields', async () => {
            const res = await app.request('/api/ciphers/import', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    Ciphers: [
                        { Type: 1, Name: 'PascalLogin', Login: { Username: 'pu' } }
                    ],
                    Folders: [
                        { Name: 'PascalFolder' }
                    ]
                })
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.success).toBe(true)
        })
    })
})

// =============================================================================
// Sync Integration Tests
// =============================================================================

describe('Integration: Sync', () => {
    let env: ReturnType<typeof createTestEnv>
    let accessToken: string

    beforeEach(async () => {
        env = createTestEnv()

        // Register and login
        await app.request('/api/accounts/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'sync@example.com',
                masterPasswordHash: 'syncHash',
                key: 'syncKey',
                name: 'Sync User'
            })
        }, env)

        const loginRes = await app.request('/identity/connect/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'password',
                username: 'sync@example.com',
                password: 'syncHash'
            }).toString()
        }, env)
        const loginData = await loginRes.json() as any
        accessToken = loginData.access_token
    })

    describe('Full Sync', () => {
        it('returns complete sync data structure', async () => {
            // Create some data first
            await app.request('/api/folders', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: 'SyncFolder' })
            }, env)

            await app.request('/api/ciphers', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ type: 1, name: 'SyncCipher', login: {} })
            }, env)

            // Now sync
            const res = await app.request('/api/sync', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any

            // Verify sync structure
            expect(data.object).toBe('sync')
            expect(data.profile).toBeDefined()
            expect(data.folders).toBeDefined()
            expect(data.ciphers).toBeDefined()
            expect(data.domains).toBeDefined()

            // Verify profile
            expect(data.profile.email).toBe('sync@example.com')
            expect(data.profile.object).toBe('profile')
            expect(data.profile.emailVerified).toBe(true)
            expect(data.profile.premium).toBe(true)

            // Verify domains structure
            expect(data.domains.equivalentDomains).toBeDefined()
            expect(data.domains.globalEquivalentDomains).toBeDefined()
            expect(data.domains.object).toBe('domains')

            // Verify data was synced
            expect(data.folders).toHaveLength(1)
            expect(data.ciphers).toHaveLength(1)
        })

        it('returns 401 without authorization', async () => {
            const res = await app.request('/api/sync', {
                method: 'GET'
            }, env)

            expect(res.status).toBe(401)
        })
    })

    describe('Profile', () => {
        it('returns user profile with correct structure', async () => {
            const res = await app.request('/api/accounts/profile', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any

            expect(data.object).toBe('profile')
            expect(data.id).toBeDefined()
            expect(data.email).toBe('sync@example.com')
            expect(data.emailVerified).toBe(true)
            expect(data.premium).toBe(true)
            expect(data.twoFactorEnabled).toBe(false)
            expect(data.key).toBe('syncKey')
            expect(data.securityStamp).toBeDefined()
            expect(data.culture).toBeDefined()
            expect(data.organizations).toEqual([])

            // New profile fields
            expect(data.premiumFromOrganization).toBe(false)
            expect(data.forcePasswordReset).toBe(false)
            expect(data.usesKeyConnector).toBe(false)
            expect(data.verifyDevices).toBe(true)
            expect(data.providers).toEqual([])
            expect(data.providerOrganizations).toEqual([])
            expect(data.creationDate).toBeDefined()
        })
    })

    describe('Revision Date', () => {
        it('returns ISO date string', async () => {
            const res = await app.request('/api/accounts/revision-date', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json()
            expect(typeof data).toBe('string')
            // Verify it's a valid ISO date
            expect(new Date(data as string).toISOString()).toBeDefined()
        })
    })
})

// =============================================================================
// Config & Stubs Integration Tests
// =============================================================================

describe('Integration: Config & Stubs', () => {
    let env: ReturnType<typeof createTestEnv>

    beforeEach(() => {
        env = createTestEnv()
    })

    describe('Server Config', () => {
        it('returns config with all required fields', async () => {
            const res = await app.request('/api/config', {
                method: 'GET'
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any

            expect(data.version).toBe('2.0.0')
            expect(data.object).toBe('config')
            expect(data.settings).toBeDefined()
            expect(data.environment).toBeDefined()

            // Verify environment URLs
            expect(data.environment.vault).toBeDefined()
            expect(data.environment.api).toBeDefined()
            expect(data.environment.identity).toBeDefined()
        })
    })

    describe('Features', () => {
        it('returns feature flags', async () => {
            const res = await app.request('/api/accounts/features', {
                method: 'GET'
            }, env)

            expect(res.status).toBe(200)
            const data = await res.json() as any

            expect(data.premium).toBe(true)
            expect(data['self-host']).toBe(true)
            expect(data['import-export']).toBe(true)
        })
    })

    describe('Stubs', () => {
        const stubCases = [
            { path: '/api/devices/knowndevice', method: 'GET' },
            { path: '/api/two-factor', method: 'GET' },
            { path: '/api/accounts/password-hint', method: 'POST' },
            { path: '/api/settings/domains', method: 'GET' },
            { path: '/api/emergency-access/trusted', method: 'GET' },
            { path: '/api/emergency-access/granted', method: 'GET' },
            { path: '/notifications/hub', method: 'GET' },
            { path: '/notifications/hub/negotiate', method: 'GET' }
        ]

        stubCases.forEach(({ path, method }) => {
            it(`${method} ${path} returns success`, async () => {
                const res = await app.request(path, { method }, env)
                expect(res.status).toBe(200)
            })
        })
    })

    describe('Icons Proxy', () => {
        it('redirects public domain to icon service', async () => {
            const res = await app.request('/icons/github.com/icon.png', {
                method: 'GET'
            }, env)

            expect(res.status).toBe(302)
            expect(res.headers.get('Location')).toContain('github.com')
        })

        const privateIPs = [
            '192.168.1.1',
            '10.0.0.1',
            '172.16.0.1',
            '127.0.0.1',
            'localhost'
        ]

        privateIPs.forEach(ip => {
            it(`returns 204 for private IP ${ip}`, async () => {
                const res = await app.request(`/icons/${ip}/icon.png`, {
                    method: 'GET'
                }, env)

                expect(res.status).toBe(204)
            })
        })
    })
})

// =============================================================================
// Health Check
// =============================================================================

describe('Integration: Health', () => {
    it('returns health status', async () => {
        const env = createTestEnv()
        const res = await app.request('/health', { method: 'GET' }, env)

        expect(res.status).toBe(200)
        const data = await res.json() as any
        expect(data.status).toBe('ok')
        expect(data.version).toBe('2.0.0')
    })
})
