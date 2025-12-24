import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from './index'

// --------------------------------------------------------------------------
// Mock Environment Setup
// --------------------------------------------------------------------------

// Helper: Create mock user data (camelCase)
// masterPasswordHash is SHA-256(securityStamp + clientHash)
// SHA-256('stamp-123' + 'hashedPassword123') = 'fabaf2e0faf57ba77214d5bccf667ae427c7c73b41cc7a6b832453948c6d0ac4'
const createMockUser = (overrides = {}) => ({
  id: 'user-123',
  email: 'test@example.com',
  masterPasswordHash: 'fabaf2e0faf57ba77214d5bccf667ae427c7c73b41cc7a6b832453948c6d0ac4',
  key: 'encryptedKey123',
  kdf: 0,
  kdfIterations: 100000,
  securityStamp: 'stamp-123',
  culture: 'en-US',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides
})

// Default mock user for JWT validation
const defaultMockUser = createMockUser()

const createMockEnv = () => {
  // Smart DB mock that returns appropriate data based on key prefix
  const dbGet = vi.fn().mockImplementation((key: string) => {
    if (key.startsWith('user:')) {
      return Promise.resolve(JSON.stringify(defaultMockUser))
    }
    if (key.startsWith('vault_index:')) {
      return Promise.resolve(JSON.stringify({ cipherIds: [], folderIds: [], revision: '' }))
    }
    return Promise.resolve(null)
  })

  return {
    DB: {
      get: dbGet,
      put: vi.fn(),
      delete: vi.fn()
    },
    VAULT: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue({ objects: [] })
    },
    JWT_SECRET: 'test-secret-key-for-jwt'
  }
}

// Helper: Create a valid JWT token for testing (must be access token type)
const createTestToken = async () => {
  const { sign } = await import('hono/jwt')
  return sign({
    sub: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    email_verified: true,
    stamp: 'stamp-123',
    token_type: 'access',
    exp: Math.floor(Date.now() / 1000) + 3600
  }, 'test-secret-key-for-jwt')
}

// Helper: Create mock cipher data (camelCase)
const createMockCipher = (overrides = {}) => ({
  id: 'cipher-123',
  type: 1,
  name: 'Test Login',
  favorite: false,
  reprompt: 0,
  revisionDate: '2024-01-01T00:00:00Z',
  creationDate: '2024-01-01T00:00:00Z',
  object: 'cipher',
  login: { username: 'user', password: 'pass' },
  ...overrides
})

describe('NanoVault API', () => {
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockEnv = createMockEnv()
    vi.clearAllMocks()
  })

  // ==========================================================================
  // Prelogin Tests
  // ==========================================================================

  describe('Prelogin', () => {
    const testCases = [
      {
        name: 'returns default KDF for new user',
        email: 'new@example.com',
        existingUser: null,
        expectedKdf: 0,
        expectedIterations: 100000
      },
      {
        name: 'returns Argon2 KDF for existing user',
        email: 'argon@example.com',
        existingUser: { kdf: 1, kdfIterations: 3, kdfMemory: 64, kdfParallelism: 4 },
        expectedKdf: 1,
        expectedIterations: 3
      }
    ]

    testCases.forEach(({ name, email, existingUser, expectedKdf, expectedIterations }) => {
      it(name, async () => {
        mockEnv.DB.get.mockResolvedValue(existingUser ? JSON.stringify(existingUser) : null)

        const res = await app.request('/api/accounts/prelogin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        }, mockEnv)

        expect(res.status).toBe(200)
        const data: any = await res.json()
        expect(data.kdf).toBe(expectedKdf)
        expect(data.kdfIterations).toBe(expectedIterations)
      })
    })

    it('supports both /api and /identity paths', async () => {
      mockEnv.DB.get.mockResolvedValue(null)

      const paths = ['/api/accounts/prelogin', '/identity/accounts/prelogin']
      for (const path of paths) {
        const res = await app.request(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Email: 'test@example.com' })
        }, mockEnv)
        expect(res.status).toBe(200)
      }
    })

    it('returns 400 for missing email', async () => {
      const res = await app.request('/api/accounts/prelogin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }, mockEnv)

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // Register Tests (new flow with token verification)
  // ==========================================================================

  describe('Register', () => {
    it('creates new user with valid registration token', async () => {
      mockEnv.DB.get.mockResolvedValue(null)

      // First generate a registration token (simulating what the API does)
      const { sign } = await import('hono/jwt')
      const token = await sign({
        email: 'new@example.com',
        name: '',
        type: 'registration',
        exp: Math.floor(Date.now() / 1000) + 3600
      }, 'test-secret-key-for-jwt')

      const res = await app.request('/identity/accounts/register/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'new@example.com',
          masterPasswordHash: 'hash123',
          userSymmetricKey: 'encryptedKey123',
          emailVerificationToken: token
        })
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.id).toBeDefined()
      expect(mockEnv.DB.put).toHaveBeenCalled()
    })

    it('creates new user with Argon2 KDF settings', async () => {
      mockEnv.DB.get.mockResolvedValue(null)

      const { sign } = await import('hono/jwt')
      const token = await sign({
        email: 'argon2@example.com',
        type: 'registration',
        exp: Math.floor(Date.now() / 1000) + 3600
      }, 'test-secret-key-for-jwt')

      const res = await app.request('/identity/accounts/register/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'argon2@example.com',
          masterPasswordHash: 'hash123',
          userSymmetricKey: 'encryptedKey123',
          kdf: 1,
          kdfIterations: 600000,
          emailVerificationToken: token
        })
      }, mockEnv)

      expect(res.status).toBe(200)
    })

    it('rejects duplicate email', async () => {
      mockEnv.DB.get.mockResolvedValue(JSON.stringify(createMockUser()))

      const { sign } = await import('hono/jwt')
      const token = await sign({
        email: 'test@example.com',
        type: 'registration',
        exp: Math.floor(Date.now() / 1000) + 3600
      }, 'test-secret-key-for-jwt')

      const res = await app.request('/identity/accounts/register/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          masterPasswordHash: 'hash',
          userSymmetricKey: 'key',
          emailVerificationToken: token
        })
      }, mockEnv)

      expect(res.status).toBe(400)
      const data: any = await res.json()
      expect(data.message).toContain('exists')
    })

    it('rejects registration without token', async () => {
      mockEnv.DB.get.mockResolvedValue(null)

      const res = await app.request('/identity/accounts/register/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          masterPasswordHash: 'hash',
          userSymmetricKey: 'key'
        })
      }, mockEnv)

      expect(res.status).toBe(400)
      const data: any = await res.json()
      expect(data.message).toMatch(/token/i)
    })

    it('legacy endpoints return error', async () => {
      const res = await app.request('/api/accounts/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          masterPasswordHash: 'hash',
          key: 'key'
        })
      }, mockEnv)

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // Token (Login) Tests
  // ==========================================================================

  describe('Token', () => {
    it('returns tokens for valid password grant', async () => {
      mockEnv.DB.get.mockResolvedValue(JSON.stringify(createMockUser()))

      const res = await app.request('/identity/connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'test@example.com',
          password: 'hashedPassword123'
        }).toString()
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.access_token).toBeDefined()
      expect(data.refresh_token).toBeDefined()
      expect(data.token_type).toBe('Bearer')
      expect(data.key).toBe('encryptedKey123')
      expect(data.userDecryptionOptions).toBeDefined()
      expect(data.userDecryptionOptions.hasMasterPassword).toBe(true)
    })

    it('rejects invalid password', async () => {
      mockEnv.DB.get.mockResolvedValue(JSON.stringify(createMockUser()))

      const res = await app.request('/identity/connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'test@example.com',
          password: 'wrongPassword'
        }).toString()
      }, mockEnv)

      expect(res.status).toBe(400)
      const data: any = await res.json()
      expect(data.message).toContain('Invalid')
    })

    it('rejects unknown user', async () => {
      mockEnv.DB.get.mockResolvedValue(null)

      const res = await app.request('/identity/connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'unknown@example.com',
          password: 'hash'
        }).toString()
      }, mockEnv)

      expect(res.status).toBe(400)
      const data: any = await res.json()
      expect(data.message).toContain('Invalid')
    })

    it('rejects unsupported grant type', async () => {
      const res = await app.request('/identity/connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials'
        }).toString()
      }, mockEnv)

      expect(res.status).toBe(400)
      const data: any = await res.json()
      expect(data.message).toContain('Unsupported')
    })
  })

  // ==========================================================================
  // Sync Tests
  // ==========================================================================

  describe('Sync', () => {
    it('returns sync data for authenticated user', async () => {
      const token = await createTestToken()
      mockEnv.DB.get.mockResolvedValue(JSON.stringify(createMockUser()))
      mockEnv.VAULT.list.mockResolvedValue({ objects: [] })

      const res = await app.request('/api/sync', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.object).toBe('sync')
      expect(data.profile).toBeDefined()
      expect(data.profile.email).toBe('test@example.com')
      expect(data.folders).toEqual([])
      expect(data.ciphers).toEqual([])
    })

    it('returns 401 without token', async () => {
      const res = await app.request('/api/sync', {
        method: 'GET'
      }, mockEnv)

      expect(res.status).toBe(401)
    })

    it('returns profile for authenticated user', async () => {
      const token = await createTestToken()
      mockEnv.DB.get.mockResolvedValue(JSON.stringify(createMockUser({ name: 'John Doe' })))

      const res = await app.request('/api/accounts/profile', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.object).toBe('profile')
      expect(data.name).toBe('John Doe')
      expect(data.emailVerified).toBe(true)
      expect(data.premium).toBe(true)
    })

    it('returns revision date', async () => {
      const token = await createTestToken()
      mockEnv.DB.get.mockResolvedValue(JSON.stringify(createMockUser({ updatedAt: '2024-06-15T10:00:00Z' })))

      const res = await app.request('/api/accounts/revision-date', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }, mockEnv)

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toBe('2024-06-15T10:00:00Z')
    })
  })

  // ==========================================================================
  // Ciphers Tests
  // ==========================================================================

  describe('Ciphers', () => {
    it('creates a new cipher', async () => {
      const token = await createTestToken()
      mockEnv.VAULT.put.mockResolvedValue(undefined)
      mockEnv.DB.get.mockImplementation((key: string) => {
        if (key.startsWith('user:')) return Promise.resolve(JSON.stringify(defaultMockUser))
        if (key.startsWith('vault_index:')) return Promise.resolve(JSON.stringify({ cipherIds: [], folderIds: [], revision: '' }))
        return Promise.resolve(null)
      })
      mockEnv.DB.put.mockResolvedValue(undefined)

      const res = await app.request('/api/ciphers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 1,
          name: 'New Login',
          login: { username: 'user', password: 'pass' }
        })
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.id).toBeDefined()
      expect(data.name).toBe('New Login')
      expect(data.type).toBe(1)
      expect(data.object).toBe('cipher')
      expect(mockEnv.VAULT.put).toHaveBeenCalled()
    })

    it('gets a cipher by ID', async () => {
      const token = await createTestToken()
      const mockCipher = createMockCipher()
      mockEnv.VAULT.get.mockResolvedValue({
        json: () => Promise.resolve(mockCipher)
      })

      const res = await app.request('/api/ciphers/cipher-123', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.id).toBe('cipher-123')
      expect(data.name).toBe('Test Login')
    })

    it('returns 404 for non-existent cipher', async () => {
      const token = await createTestToken()
      mockEnv.VAULT.get.mockResolvedValue(null)

      const res = await app.request('/api/ciphers/nonexistent', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }, mockEnv)

      expect(res.status).toBe(404)
    })

    it('updates a cipher', async () => {
      const token = await createTestToken()
      mockEnv.VAULT.get.mockResolvedValue({
        json: () => Promise.resolve(createMockCipher())
      })
      mockEnv.VAULT.put.mockResolvedValue(undefined)

      const res = await app.request('/api/ciphers/cipher-123', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 1,
          name: 'Updated Login',
          login: { username: 'newuser', password: 'newpass' }
        })
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.name).toBe('Updated Login')
      expect(mockEnv.VAULT.put).toHaveBeenCalled()
    })

    it('deletes a cipher', async () => {
      const token = await createTestToken()
      mockEnv.VAULT.delete.mockResolvedValue(undefined)
      mockEnv.VAULT.list.mockResolvedValue({ objects: [] })
      mockEnv.DB.get.mockImplementation((key: string) => {
        if (key.startsWith('user:')) return Promise.resolve(JSON.stringify(defaultMockUser))
        if (key.startsWith('vault_index:')) return Promise.resolve(JSON.stringify({ cipherIds: ['cipher-123'], folderIds: [], revision: '' }))
        return Promise.resolve(null)
      })
      mockEnv.DB.put.mockResolvedValue(undefined)

      const res = await app.request('/api/ciphers/cipher-123', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }, mockEnv)

      expect(res.status).toBe(200)
      expect(mockEnv.VAULT.delete).toHaveBeenCalled()
    })

    it('soft deletes a cipher (move to trash)', async () => {
      const token = await createTestToken()
      mockEnv.VAULT.get.mockResolvedValue({
        json: () => Promise.resolve(createMockCipher())
      })
      mockEnv.VAULT.put.mockResolvedValue(undefined)

      const res = await app.request('/api/ciphers/cipher-123/delete', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.deletedDate).toBeDefined()
    })

    it('restores a cipher from trash', async () => {
      const token = await createTestToken()
      mockEnv.VAULT.get.mockResolvedValue({
        json: () => Promise.resolve(createMockCipher({ deletedDate: '2024-01-01T00:00:00Z' }))
      })
      mockEnv.VAULT.put.mockResolvedValue(undefined)

      const res = await app.request('/api/ciphers/cipher-123/restore', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.deletedDate).toBeNull()
    })

    it('imports ciphers and folders', async () => {
      const token = await createTestToken()
      mockEnv.VAULT.put.mockResolvedValue(undefined)
      mockEnv.DB.get.mockImplementation((key: string) => {
        if (key.startsWith('user:')) return Promise.resolve(JSON.stringify(defaultMockUser))
        if (key.startsWith('vault_index:')) return Promise.resolve(JSON.stringify({ cipherIds: [], folderIds: [], revision: '' }))
        return Promise.resolve(null)
      })
      mockEnv.DB.put.mockResolvedValue(undefined)

      const res = await app.request('/api/ciphers/import', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ciphers: [
            { type: 1, name: 'Imported Login' },
            { type: 2, name: 'Imported Note' }
          ],
          folders: [
            { name: 'Work' },
            { name: 'Personal' }
          ]
        })
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.success).toBe(true)
      expect(data.ciphers).toHaveLength(2)
      expect(data.folders).toHaveLength(2)
    })
  })

  // ==========================================================================
  // Folders Tests
  // ==========================================================================

  describe('Folders', () => {
    it('creates a new folder', async () => {
      const token = await createTestToken()
      mockEnv.VAULT.put.mockResolvedValue(undefined)
      mockEnv.DB.get.mockImplementation((key: string) => {
        if (key.startsWith('user:')) return Promise.resolve(JSON.stringify(defaultMockUser))
        if (key.startsWith('vault_index:')) return Promise.resolve(JSON.stringify({ cipherIds: [], folderIds: [], revision: '' }))
        return Promise.resolve(null)
      })
      mockEnv.DB.put.mockResolvedValue(undefined)

      const res = await app.request('/api/folders', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'Work' })
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.id).toBeDefined()
      expect(data.name).toBe('Work')
      expect(data.object).toBe('folder')
    })

    it('creates folder with PascalCase name', async () => {
      const token = await createTestToken()
      mockEnv.VAULT.put.mockResolvedValue(undefined)
      mockEnv.DB.get.mockImplementation((key: string) => {
        if (key.startsWith('user:')) return Promise.resolve(JSON.stringify(defaultMockUser))
        if (key.startsWith('vault_index:')) return Promise.resolve(JSON.stringify({ cipherIds: [], folderIds: [], revision: '' }))
        return Promise.resolve(null)
      })
      mockEnv.DB.put.mockResolvedValue(undefined)

      const res = await app.request('/api/folders', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ Name: 'Personal' })
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.name).toBe('Personal')
    })

    it('rejects folder without name', async () => {
      const token = await createTestToken()

      const res = await app.request('/api/folders', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      }, mockEnv)

      expect(res.status).toBe(400)
    })

    it('gets a folder by ID', async () => {
      const token = await createTestToken()
      mockEnv.VAULT.get.mockResolvedValue({
        json: () => Promise.resolve({ id: 'folder-123', name: 'Work', object: 'folder' })
      })

      const res = await app.request('/api/folders/folder-123', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.name).toBe('Work')
    })

    it('updates a folder', async () => {
      const token = await createTestToken()
      mockEnv.VAULT.get.mockResolvedValue({
        json: () => Promise.resolve({ id: 'folder-123', name: 'Old Name', object: 'folder' })
      })
      mockEnv.VAULT.put.mockResolvedValue(undefined)

      const res = await app.request('/api/folders/folder-123', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'New Name' })
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.name).toBe('New Name')
    })

    it('deletes a folder', async () => {
      const token = await createTestToken()
      mockEnv.VAULT.delete.mockResolvedValue(undefined)
      mockEnv.DB.get.mockImplementation((key: string) => {
        if (key.startsWith('user:')) return Promise.resolve(JSON.stringify(defaultMockUser))
        if (key.startsWith('vault_index:')) return Promise.resolve(JSON.stringify({ cipherIds: [], folderIds: ['folder-123'], revision: '' }))
        return Promise.resolve(null)
      })
      mockEnv.DB.put.mockResolvedValue(undefined)

      const res = await app.request('/api/folders/folder-123', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }, mockEnv)

      expect(res.status).toBe(200)
    })
  })

  // ==========================================================================
  // Config Tests
  // ==========================================================================

  describe('Config', () => {
    it('returns server config with correct URLs', async () => {
      const res = await app.request('/api/config', {
        method: 'GET'
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.version).toBe('2.0.0')
      expect(data.object).toBe('config')
      expect(data.settings).toBeDefined()
      expect(data.environment).toBeDefined()
    })

    it('returns features', async () => {
      const res = await app.request('/api/accounts/features', {
        method: 'GET'
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.premium).toBe(true)
      expect(data['self-host']).toBe(true)
      expect(data['import-export']).toBe(true)
    })

    it('handles known device check', async () => {
      const res = await app.request('/api/devices/knowndevice', {
        method: 'GET'
      }, mockEnv)

      expect(res.status).toBe(200)
    })

    it('returns empty two-factor list', async () => {
      const res = await app.request('/api/two-factor', {
        method: 'GET'
      }, mockEnv)

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(Array.isArray(data)).toBe(true)
    })
  })

  // ==========================================================================
  // Icons Tests
  // ==========================================================================

  describe('Icons', () => {
    it('redirects public domain to icon service', async () => {
      const res = await app.request('/icons/example.com/icon.png', {
        method: 'GET'
      }, mockEnv)

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toContain('example.com')
    })

    it('returns 204 for private IP (192.168.x.x)', async () => {
      const res = await app.request('/icons/192.168.1.1/icon.png', {
        method: 'GET'
      }, mockEnv)

      expect(res.status).toBe(204)
    })

    it('returns 204 for private IP (10.x.x.x)', async () => {
      const res = await app.request('/icons/10.0.0.1/icon.png', {
        method: 'GET'
      }, mockEnv)

      expect(res.status).toBe(204)
    })

    it('returns 204 for localhost', async () => {
      const res = await app.request('/icons/localhost/icon.png', {
        method: 'GET'
      }, mockEnv)

      expect(res.status).toBe(204)
    })

    it('returns 204 for loopback (127.x.x.x)', async () => {
      const res = await app.request('/icons/127.0.0.1/icon.png', {
        method: 'GET'
      }, mockEnv)

      expect(res.status).toBe(204)
    })
  })

  // ==========================================================================
  // Health Check
  // ==========================================================================

  describe('Health', () => {
    it('returns health status', async () => {
      const res = await app.request('/health', {
        method: 'GET'
      }, mockEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.status).toBe('ok')
      expect(data.version).toBe('2.0.0')
    })
  })
})
