#!/bin/bash
# Build script for Rhaone Orchestrator

set -e

echo "🦞 Rhaone Orchestrator - Build Script"
echo "======================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}Error: Node.js 20+ required (found $(node -v))${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# Clean previous build
echo ""
echo "🧹 Cleaning previous build..."
rm -rf dist

# Install dependencies if needed
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
    echo ""
    echo "📦 Installing dependencies..."
    npm ci
fi

# Build TypeScript
echo ""
echo "🔨 Building TypeScript..."
npm run build

# Verify build
echo ""
echo "🔍 Verifying build..."
if [ ! -f "dist/index.js" ]; then
    echo -e "${RED}Error: Build failed - dist/index.js not found${NC}"
    exit 1
fi

if [ ! -f "dist/cli.js" ]; then
    echo -e "${RED}Error: Build failed - dist/cli.js not found${NC}"
    exit 1
fi

# Check CLI is executable
if [ ! -x "dist/cli.js" ]; then
    echo "📋 Making CLI executable..."
    chmod +x dist/cli.js
fi

echo -e "${GREEN}✓${NC} Build successful"

# Run tests
echo ""
echo "🧪 Running tests..."
npm test

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}✓ Build complete!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo "Next steps:"
echo "  npm run publish:public  - Publish to NPM"
echo "  npm pack                - Create tarball"
echo ""
