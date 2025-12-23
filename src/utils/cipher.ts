/**
 * Cipher Utility Functions
 * 
 * Handles cipher object creation and normalization.
 */

import type { Cipher } from '../types'

/**
 * Options for building a cipher object.
 */
export interface BuildCipherOptions {
    /** Existing cipher to merge with (for updates) */
    existing?: Cipher | null
    /** Override the cipher ID */
    id?: string
    /** Creation timestamp (defaults to now) */
    creationDate?: string
}

/**
 * Builds a normalized Cipher object from request body.
 * Handles both PascalCase and camelCase input fields.
 * 
 * @param body - Raw request body from client
 * @param opts - Optional build configuration
 * @returns A normalized Cipher object
 */
export function buildCipher(body: Record<string, any>, opts: BuildCipherOptions = {}): Cipher {
    const { existing, id, creationDate } = opts
    const now = new Date().toISOString()

    return {
        id: id ?? body.Id ?? body.id ?? crypto.randomUUID(),
        type: body.Type ?? body.type ?? existing?.type ?? 1,
        organizationId: body.OrganizationId ?? body.organizationId ?? null,
        folderId: body.FolderId ?? body.folderId ?? null,
        favorite: body.Favorite ?? body.favorite ?? false,
        reprompt: body.Reprompt ?? body.reprompt ?? 0,
        name: body.Name ?? body.name ?? '',
        notes: body.Notes ?? body.notes ?? null,
        fields: body.Fields ?? body.fields ?? null,
        login: body.Login ?? body.login ?? null,
        card: body.Card ?? body.card ?? null,
        identity: body.Identity ?? body.identity ?? null,
        secureNote: body.SecureNote ?? body.secureNote ?? null,
        sshKey: body.SshKey ?? body.sshKey ?? null,
        revisionDate: now,
        creationDate: creationDate ?? existing?.creationDate ?? now,
        deletedDate: null,
        archivedDate: body.ArchivedDate ?? body.archivedDate ?? null,
        key: body.Key ?? body.key ?? null,
        passwordHistory: body.PasswordHistory ?? body.passwordHistory ?? existing?.passwordHistory ?? null,
        edit: true,
        viewPassword: true,
        organizationUseTotp: false,
        data: body.Data ?? body.data,
        object: 'cipher',
        attachments: body.Attachments ?? body.attachments ?? null,
        collectionIds: body.CollectionIds ?? body.collectionIds ?? [],
    }
}

/**
 * Validates that a cipher has required fields.
 * 
 * @param cipher - The cipher to validate
 * @returns Error message if invalid, null if valid
 */
export function validateCipher(cipher: Cipher): string | null {
    if (cipher.type === undefined) {
        return 'Invalid cipher data: Type required'
    }
    if (!cipher.name) {
        return 'Invalid cipher data: Name required'
    }
    return null
}
