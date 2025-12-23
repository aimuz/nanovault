import type { Context } from 'hono'

// Environment bindings type - reused across modules
export interface Bindings {
  DB: KVNamespace
  VAULT: R2Bucket
  JWT_SECRET: string
}

// Bitwarden KDF types
export const KDF_PBKDF2 = 0
export const KDF_ARGON2 = 1

// --------------------------------------------------------------------------
// API Request/Response Types (accept both cases for input)
// --------------------------------------------------------------------------

export interface PreloginRequest {
  email?: string
  Email?: string
}

export interface PreloginResponse {
  kdf: number
  kdfIterations: number
  kdfMemory?: number
  kdfParallelism?: number
}

export interface RegisterRequest {
  name?: string
  email?: string
  masterPasswordHash?: string
  masterPasswordHint?: string
  key?: string
  kdf?: number
  kdfIterations?: number
  keys?: {
    publicKey: string
    encryptedPrivateKey: string
  }
  // PascalCase variants for input compatibility
  Name?: string
  Email?: string
  MasterPasswordHash?: string
  MasterPasswordHint?: string
  Key?: string
  Kdf?: number
  KdfIterations?: number
  Keys?: {
    PublicKey: string
    EncryptedPrivateKey: string
  }
}

// --------------------------------------------------------------------------
// User Data (stored in KV)
// --------------------------------------------------------------------------

export interface UserData {
  id: string
  email: string
  masterPasswordHash: string
  masterPasswordHint?: string
  key: string
  kdf: number
  kdfIterations: number
  kdfMemory?: number
  kdfParallelism?: number
  name?: string
  publicKey?: string
  encryptedPrivateKey?: string
  securityStamp: string
  culture: string
  createdAt: string
  updatedAt: string
  // Domain settings
  equivalentDomains?: string[][]  // User-defined equivalent domain groups
  excludedGlobalEquivalentDomains?: number[]  // Excluded global domain types
}

// --------------------------------------------------------------------------
// Vault Data (stored in S3)
// --------------------------------------------------------------------------

export interface Cipher {
  id: string
  type: number // 1=Login, 2=SecureNote, 3=Card, 4=Identity, 5=SSHKey
  organizationId?: string | null
  folderId?: string | null
  favorite: boolean
  reprompt: number
  name: string
  notes?: string | null
  fields?: CipherField[] | null
  login?: LoginData | null
  card?: CardData | null
  identity?: IdentityData | null
  secureNote?: SecureNoteData | null
  sshKey?: SSHKeyData | null
  revisionDate: string
  creationDate: string
  deletedDate?: string | null
  archivedDate?: string | null
  key?: string | null
  passwordHistory?: PasswordHistoryEntry[] | null
  edit?: boolean
  viewPassword?: boolean
  organizationUseTotp?: boolean
  data?: any
  object: string
  attachments?: AttachmentMeta[] | null
  collectionIds?: string[]
}

export interface CipherField {
  type: number
  name: string
  value: string
  linkedId?: number
}

export interface LoginData {
  uris?: { uri: string; match?: number | null }[] | null
  username?: string | null
  password?: string | null
  totp?: string | null
  passwordRevisionDate?: string | null
  autofillOnPageLoad?: boolean | null
}

export interface CardData {
  cardholderName?: string | null
  brand?: string | null
  number?: string | null
  expMonth?: string | null
  expYear?: string | null
  code?: string | null
}

export interface IdentityData {
  title?: string | null
  firstName?: string | null
  middleName?: string | null
  lastName?: string | null
  address1?: string | null
  address2?: string | null
  address3?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
  company?: string | null
  email?: string | null
  phone?: string | null
  ssn?: string | null
  username?: string | null
  passportNumber?: string | null
  licenseNumber?: string | null
}

export interface SecureNoteData {
  type: number
}

export interface SSHKeyData {
  privateKey?: string | null
  publicKey?: string | null
  fingerprint?: string | null
}

export interface PasswordHistoryEntry {
  password: string
  lastUsedDate: string
}

export interface Folder {
  id: string
  name: string
  revisionDate: string
  object: string
}

export interface AttachmentMeta {
  id: string
  fileName: string
  size: number
  sizeName: string
  key: string
  url?: string
}

// --------------------------------------------------------------------------
// Vault Index (stored in KV for quick lookups)
// --------------------------------------------------------------------------

export interface VaultIndex {
  cipherIds: string[]
  folderIds: string[]
  revision: string
}

// --------------------------------------------------------------------------
// Sync Response
// --------------------------------------------------------------------------

export interface SyncResponse {
  object: string
  profile: ProfileData
  folders: Folder[]
  ciphers: Cipher[]
  domains: DomainsData
}

export interface ProfileData {
  id: string
  name?: string | null
  email: string
  emailVerified: boolean
  premium: boolean
  premiumFromOrganization?: boolean
  masterPasswordHint?: string | null
  culture: string
  twoFactorEnabled: boolean
  key: string
  publicKey?: string | null
  privateKey?: string | null
  securityStamp: string
  forcePasswordReset?: boolean
  usesKeyConnector?: boolean
  avatarColor?: string | null
  creationDate?: string
  verifyDevices?: boolean
  organizations: any[]
  providers?: any[]
  providerOrganizations?: any[]
  object: string
}

export interface DomainsData {
  equivalentDomains: string[][]  // User-defined equivalent domain groups
  globalEquivalentDomains: GlobalEquivalentDomain[]
  object: string
}

export interface GlobalEquivalentDomain {
  type: number
  domains: string[]
  excluded: boolean
}

// --------------------------------------------------------------------------
// Utility Types
// --------------------------------------------------------------------------

export type HonoContext = Context<{ Bindings: Bindings }>