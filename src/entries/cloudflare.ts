/**
 * Cloudflare Worker Entry Point
 * 
 * This is the entry point for Cloudflare Workers deployment.
 * Cloudflare's KVNamespace and R2Bucket are compatible with our interfaces.
 */

import { createApp } from '../app'

const app = createApp()

export default app
