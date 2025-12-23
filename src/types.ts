import type { Context } from 'hono'

// Environment bindings type - reused across modules
export interface Bindings {
  DB: KVNamespace
  VAULT: R2Bucket
  JWT_SECRET: string
  // Push notification config (optional)
  PUSH_ENABLED?: string
  PUSH_INSTALLATION_ID?: string
  PUSH_INSTALLATION_KEY?: string
  PUSH_RELAY_URI?: string
  PUSH_IDENTITY_URI?: string
}

// Bitwarden device types
export const DEVICE_TYPE_ANDROID = 0
export const DEVICE_TYPE_IOS = 1
export const DEVICE_TYPE_CHROME_EXTENSION = 2
export const DEVICE_TYPE_FIREFOX_EXTENSION = 3
export const DEVICE_TYPE_OPERA_EXTENSION = 4
export const DEVICE_TYPE_EDGE_EXTENSION = 5
export const DEVICE_TYPE_WINDOWS = 6
export const DEVICE_TYPE_MACOS = 7
export const DEVICE_TYPE_LINUX = 8
export const DEVICE_TYPE_CHROME_BROWSER = 9
export const DEVICE_TYPE_FIREFOX_BROWSER = 10
export const DEVICE_TYPE_OPERA_BROWSER = 11
export const DEVICE_TYPE_EDGE_BROWSER = 12
export const DEVICE_TYPE_IE_BROWSER = 13
export const DEVICE_TYPE_ANDROID_AMAZON = 16
export const DEVICE_TYPE_CLI = 14
export const DEVICE_TYPE_SAFARI_BROWSER = 15

// Device data (stored in KV)
export interface Device {
  id: string
  userId: string
  name: string
  type: number
  identifier: string  // Unique device identifier from client
  pushToken?: string  // FCM/APNS token
  pushUuid?: string   // UUID from Bitwarden push service registration
  createdAt: string
  updatedAt: string
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

export interface FinishRegisterRequest {
  email: string
  masterPasswordHash: string
  masterPasswordHint?: string
  userSymmetricKey: string
  kdf?: number
  kdfIterations?: number
  userAsymmetricKeys?: {
    publicKey: string
    encryptedPrivateKey: string
  }
  emailVerificationToken: string
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
  emailVerified?: boolean  // True if registered via email verification flow
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


/** Bitwarden-style error response */
export const errorResponse = (c: AppContext, message: string, statusCode: 400 | 401 | 403 | 404 | 500 = 400) => {
  return c.json({
    message: message,
    validationErrors: { '': [message] },
    errorModel: { message: message, validationErrors: { '': [message] } },
    object: 'error'
  }, statusCode)
}

// --------------------------------------------------------------------------
// Utility Types
// --------------------------------------------------------------------------

export type HonoContext = Context<{ Bindings: Bindings }>