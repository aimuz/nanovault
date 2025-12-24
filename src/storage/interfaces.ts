/**
 * Platform-agnostic Storage Interfaces
 * 
 * These interfaces abstract over platform-specific storage implementations
 * (Cloudflare KV/R2, Aliyun EdgeKV/OSS, etc.)
 */

/**
 * Key-Value storage interface.
 * Compatible with Cloudflare KVNamespace and Aliyun EdgeKV.
 */
export interface IKVStorage {
    get(key: string): Promise<string | null>
    put(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
}

/**
 * Blob/Object storage interface.
 * Compatible with Cloudflare R2 and Aliyun OSS.
 */
export interface IBlobStorage {
    get(key: string): Promise<IBlobObject | null>
    put(key: string, body: string | ArrayBuffer | ReadableStream, options?: BlobPutOptions): Promise<void>
    delete(key: string): Promise<void>
    list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>
}

export interface IBlobObject {
    json<T = unknown>(): Promise<T>
    body?: ReadableStream
}

export interface BlobPutOptions {
    httpMetadata?: { contentType?: string }
    customMetadata?: Record<string, string>
}
