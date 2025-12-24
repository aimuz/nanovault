/**
 * NanoVault - A lightweight Bitwarden-compatible server
 * 
 * Main entry point - delegates to platform-specific entry.
 * For backward compatibility, this exports the Cloudflare Worker entry.
 */

export { default } from './entries/cloudflare'

// Also export app factory for testing and custom deployments
export { createApp } from './app'