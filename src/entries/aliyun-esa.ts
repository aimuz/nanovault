/**
 * Aliyun ESA Edge Functions Entry Point
 * 
 * Uses EdgeKV for user/index data and S3 (via AWS SDK) for vault storage.
 * Reference: megashare project patterns
 */

import { createApp } from '../app'
import { AliyunEdgeKV, getConfigFromKV } from '../adapters/aliyun-edgekv'
import { AliyunOSS } from '../adapters/aliyun-oss'
import type { Bindings } from '../types'

// ESA only supports console.alert() for logging, override other methods
declare const console: Console & { alert?: (...args: any[]) => void }
if (typeof console.alert === 'function') {
    const alert = console.alert.bind(console)
    console.log = (...args) => alert('[LOG]', ...args)
    console.error = (...args) => alert('[ERROR]', ...args,)
    console.warn = (...args) => alert('[WARN]', ...args)
    console.info = (...args) => alert('[INFO]', ...args)
    console.debug = (...args) => alert('[DEBUG]', ...args)
}

// Configuration constants
const DB_NAMESPACE = 'nanovault-db'
const CONFIG_NAMESPACE = 'nanovault-config'

/**
 * All config stored in a single JSON object to reduce KV reads.
 * Key: "config" in nanovault-config namespace
 * 
 * Expected format:
 * {
 *   "JWT_SECRET": "...",
 *   "S3_ENDPOINT": "...",
 *   "S3_BUCKET": "...",
 *   "S3_ACCESS_KEY_ID": "...",
 *   "S3_ACCESS_KEY_SECRET": "...",
 *   "S3_REGION": "...",
 *   "PUSH_ENABLED": "...",
 *   "PUSH_INSTALLATION_ID": "...",
 *   "PUSH_INSTALLATION_KEY": "...",
 *   "PUSH_RELAY_URI": "...",
 *   "PUSH_IDENTITY_URI": "...",
 *   "RESEND_API_KEY": "...",
 *   "MAIL_FROM": "..."
 * }
 */
interface AppConfig {
    JWT_SECRET?: string
    S3_ENDPOINT?: string
    S3_BUCKET?: string
    S3_ACCESS_KEY_ID?: string
    S3_ACCESS_KEY_SECRET?: string
    S3_REGION?: string
    PUSH_ENABLED?: string
    PUSH_INSTALLATION_ID?: string
    PUSH_INSTALLATION_KEY?: string
    PUSH_RELAY_URI?: string
    PUSH_IDENTITY_URI?: string
    RESEND_API_KEY?: string
    MAIL_FROM?: string
}

/**
 * ESA Edge Function handler.
 * Wraps ESA storage APIs with our platform-agnostic adapters.
 */
async function handleRequest(request: Request): Promise<Response> {
    try {
        const app = createApp()

        // Load all config from a single KV key
        const configJson = await getConfigFromKV(CONFIG_NAMESPACE, 'config')
        const config: AppConfig = configJson ? JSON.parse(configJson) : {}

        // Create adapters
        const db = new AliyunEdgeKV(DB_NAMESPACE)
        const vault = await AliyunOSS.createFromConfig({
            endpoint: config.S3_ENDPOINT || '',
            bucket: config.S3_BUCKET || '',
            accessKeyId: config.S3_ACCESS_KEY_ID || '',
            accessKeySecret: config.S3_ACCESS_KEY_SECRET || '',
            region: config.S3_REGION || '',
        })

        // Create adapted bindings
        const bindings: Bindings = {
            DB: db,
            VAULT: vault,
            JWT_SECRET: config.JWT_SECRET || 'nanovault-secret-key-change-me',
            PUSH_ENABLED: config.PUSH_ENABLED,
            PUSH_INSTALLATION_ID: config.PUSH_INSTALLATION_ID,
            PUSH_INSTALLATION_KEY: config.PUSH_INSTALLATION_KEY,
            PUSH_RELAY_URI: config.PUSH_RELAY_URI,
            PUSH_IDENTITY_URI: config.PUSH_IDENTITY_URI,
            RESEND_API_KEY: config.RESEND_API_KEY,
            MAIL_FROM: config.MAIL_FROM,
        }

        // Execute with adapted environment
        return app.fetch(request, bindings)
    } catch (err) {
        console.error('ESA Handler Error:', err)
        return new Response(JSON.stringify({ error: 'Internal Server Error', stack: err }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })
    }
}

// ESA Edge Function export format
export default { fetch: handleRequest }
