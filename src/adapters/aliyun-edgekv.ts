/**
 * Aliyun ESA EdgeKV Adapter
 * 
 * Wraps Aliyun ESA EdgeKV to implement IKVStorage interface.
 * Reference: megashare project patterns
 */

import type { IKVStorage } from '../storage/interfaces'

// EdgeKV is a global available in ESA Edge Function runtime
declare const EdgeKV: new (options: { namespace: string }) => ESAEdgeKVInstance

/**
 * Aliyun ESA EdgeKV instance type.
 */
interface ESAEdgeKVInstance {
    get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' }): Promise<string | null>
    put(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
}

/**
 * Adapter class that wraps Aliyun ESA EdgeKV.
 */
export class AliyunEdgeKV implements IKVStorage {
    private kv: ESAEdgeKVInstance

    constructor(namespace: string) {
        this.kv = new EdgeKV({ namespace })
    }

    async get(key: string): Promise<string | null> {
        return await this.kv.get(key, { type: 'text' })
    }

    async put(key: string, value: string): Promise<void> {
        await this.kv.put(key, value)
    }

    async delete(key: string): Promise<void> {
        await this.kv.delete(key)
    }
}

/**
 * Helper to get config from a dedicated EdgeKV namespace.
 */
export async function getConfigFromKV(namespace: string, key: string): Promise<string | null> {
    const kv = new EdgeKV({ namespace })
    return await kv.get(key, { type: 'text' })
}
