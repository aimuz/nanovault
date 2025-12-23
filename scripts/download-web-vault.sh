#!/bin/bash
#
# Download latest Bitwarden web vault from bw_web_builds
# https://github.com/dani-garcia/bw_web_builds
#
# Usage:
#   ./download-web-vault.sh              # Download latest stable release
#   ./download-web-vault.sh --prerelease # Download latest pre-release
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$PROJECT_DIR/public"
TMP_DIR=$(mktemp -d)

# Parse arguments
PRERELEASE=false
for arg in "$@"; do
    case $arg in
        --prerelease|-p)
            PRERELEASE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--prerelease|-p]"
            echo ""
            echo "Options:"
            echo "  --prerelease, -p  Download latest pre-release version"
            echo "  --help, -h        Show this help message"
            exit 0
            ;;
    esac
done

cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [[ "$PRERELEASE" == "true" ]]; then
    echo "==> Fetching latest pre-release info from GitHub..."
    # Get all releases and find first prerelease
    RELEASE_INFO=$(curl -sL "https://api.github.com/repos/dani-garcia/bw_web_builds/releases?per_page=20" | \
        python3 -c "import sys, json; releases = json.load(sys.stdin); pre = next((r for r in releases if r['prerelease']), None); print(json.dumps(pre) if pre else '')")
    if [[ -z "$RELEASE_INFO" || "$RELEASE_INFO" == "null" ]]; then
        echo "Error: No pre-release found"
        exit 1
    fi
else
    echo "==> Fetching latest release info from GitHub..."
    RELEASE_INFO=$(curl -sL https://api.github.com/repos/dani-garcia/bw_web_builds/releases/latest)
fi

TAG_NAME=$(echo "$RELEASE_INFO" | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4)
DOWNLOAD_URL=$(echo "$RELEASE_INFO" | grep -o '"browser_download_url": *"[^"]*\.tar\.gz"' | head -1 | cut -d'"' -f4)

if [[ -z "$TAG_NAME" || -z "$DOWNLOAD_URL" ]]; then
    echo "Error: Failed to get release information"
    exit 1
fi

echo "==> Latest version: $TAG_NAME"
echo "==> Download URL: $DOWNLOAD_URL"

# Check current version
VERSION_FILE="$WEB_DIR/.bw_web_version"
if [[ -f "$VERSION_FILE" ]]; then
    CURRENT_VERSION=$(cat "$VERSION_FILE")
    if [[ "$CURRENT_VERSION" == "$TAG_NAME" ]]; then
        echo "==> Already up to date ($TAG_NAME)"
        exit 0
    fi
    echo "==> Updating from $CURRENT_VERSION to $TAG_NAME"
else
    echo "==> Installing fresh $TAG_NAME"
fi

echo "==> Downloading..."
TARBALL="$TMP_DIR/bw_web.tar.gz"
curl -sL "$DOWNLOAD_URL" -o "$TARBALL"

echo "==> Extracting..."
tar -xzf "$TARBALL" -C "$TMP_DIR"

# The tarball contains a 'web-vault' directory
EXTRACTED_DIR="$TMP_DIR/web-vault"
if [[ ! -d "$EXTRACTED_DIR" ]]; then
    echo "Error: Expected 'web-vault' directory not found in tarball"
    exit 1
fi

# Backup existing public dir content (if any custom files exist)
echo "==> Updating $WEB_DIR..."
if [[ -d "$WEB_DIR" ]]; then
    rm -rf "$WEB_DIR"
fi
mkdir -p "$WEB_DIR"

# Copy extracted files
cp -r "$EXTRACTED_DIR"/* "$WEB_DIR/"

# Remove source map files to save space (Cloudflare has 25MB limit per asset)
echo "==> Removing source map files..."
find "$WEB_DIR" -name "*.map" -type f -delete
MAP_COUNT=$(find "$WEB_DIR" -name "*.map" -type f 2>/dev/null | wc -l | tr -d ' ')
echo "    Removed source map files (remaining: $MAP_COUNT)"

# Save version
echo "$TAG_NAME" > "$VERSION_FILE"

echo "==> Done! Bitwarden web vault $TAG_NAME installed to $WEB_DIR"
