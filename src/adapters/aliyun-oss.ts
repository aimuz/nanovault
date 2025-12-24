/**
 * Aliyun OSS Adapter (S3-compatible via aws4fetch)
 * 
 * Uses aws4fetch for Edge runtime compatibility (no DOMParser required).
 * Works with Aliyun OSS, AWS S3, and other S3-compatible storage.
 */

import { AwsClient } from 'aws4fetch'
import type { IBlobStorage, IBlobObject, BlobPutOptions } from '../storage/interfaces'

/**
 * S3/OSS configuration interface
 */
export interface S3Config {
    endpoint: string
    bucket: string
    accessKeyId: string
    accessKeySecret: string
    region: string
}

/**
 * Adapter class that wraps S3-compatible storage via aws4fetch.
 * Edge-runtime compatible - no DOMParser dependency.
 */
export class AliyunOSS implements IBlobStorage {
    private client: AwsClient
    private endpoint: string
    private bucket: string

    private constructor(config: S3Config) {
        this.bucket = config.bucket
        this.endpoint = config.endpoint
        this.client = new AwsClient({
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.accessKeySecret,
            region: config.region,
            service: 's3',
        })
    }

    /**
     * Create an AliyunOSS instance from config object directly
     */
    static async createFromConfig(config: S3Config): Promise<AliyunOSS> {
        if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.accessKeySecret) {
            throw new Error('Missing S3 configuration')
        }

        // Normalize endpoint
        let endpoint = config.endpoint.replace(/\/$/, '')
        if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
            endpoint = 'https://' + endpoint
        }

        return new AliyunOSS({
            ...config,
            endpoint,
            region: config.region || 'cn-shanghai',
        })
    }

    /**
     * Build full URL for an object key
     */
    private objectUrl(key: string): string {
        return `${this.endpoint}/${this.bucket}/${key}`
    }

    async get(key: string): Promise<IBlobObject | null> {
        try {
            const response = await this.client.fetch(this.objectUrl(key), {
                method: 'GET',
            })

            if (response.status === 404) {
                return null
            }

            if (!response.ok) {
                throw new Error(`S3 GET failed: ${response.status} ${response.statusText}`)
            }

            const responseClone = response.clone()
            return {
                async json<T = unknown>(): Promise<T> {
                    const text = await responseClone.text()
                    return JSON.parse(text) as T
                },
                body: response.body as ReadableStream,
            }
        } catch (err: any) {
            if (err.message?.includes('404') || err.status === 404) {
                return null
            }
            throw err
        }
    }

    async put(key: string, body: string | ArrayBuffer | ReadableStream, options?: BlobPutOptions): Promise<void> {
        const response = await this.client.fetch(this.objectUrl(key), {
            method: 'PUT',
            body: body as BodyInit,
            headers: {
                'Content-Type': options?.httpMetadata?.contentType || 'application/octet-stream',
            },
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`S3 PUT failed: ${response.status} ${response.statusText} - ${errorText}`)
        }
    }

    async delete(key: string): Promise<void> {
        const response = await this.client.fetch(this.objectUrl(key), {
            method: 'DELETE',
        })

        // 204 or 404 are both acceptable for DELETE
        if (!response.ok && response.status !== 404) {
            throw new Error(`S3 DELETE failed: ${response.status} ${response.statusText}`)
        }
    }

    async list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }> {
        const url = new URL(`${this.endpoint}/${this.bucket}`)
        url.searchParams.set('list-type', '2')
        if (options?.prefix) {
            url.searchParams.set('prefix', options.prefix)
        }

        const response = await this.client.fetch(url.toString(), {
            method: 'GET',
        })

        if (!response.ok) {
            throw new Error(`S3 LIST failed: ${response.status} ${response.statusText}`)
        }

        const objects: { key: string }[] = []

        // ESA HTMLStream-based XML parsing
        const htmlStream = new HTMLStream(response.body!, [[
            'Key',
            {
                text: (chunk: { text: string }) => {
                    if (chunk.text.trim()) {
                        objects.push({ key: chunk.text.trim() })
                    }
                }
            }
        ]])

        // Consume the stream
        const reader = htmlStream.getReader()
        while (true) {
            const { done } = await reader.read()
            if (done) break
        }

        return { objects }
    }
}

// Declare HTMLStream for ESA environment
declare const HTMLStream: new (
    body: ReadableStream,
    rewriters: Array<[string, { text?: (chunk: { text: string }) => void }]>
) => ReadableStream


