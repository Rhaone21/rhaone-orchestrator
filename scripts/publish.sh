#!/bin/bash
# Publish script for Rhaone Orchestrator

set -e

echo "🦞 Rhaone Orchestrator - Publish Script"
echo "========================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if NPM_TOKEN is set
if [ -z "$NPM_TOKEN" ]; then
    echo -e "${YELLOW}Warning: NPM_TOKEN not set${NC}"
    echo "Set it with: export NPM_TOKEN=your_token"
fi

# Parse arguments
TAG=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --beta)
            TAG="--tag beta"
            shift
            ;;
        --alpha)
            TAG="--tag alpha"
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Usage: $0 [--beta|--alpha] [--dry-run]"
            exit 1
            ;;
    esac
done

# Get current version
VERSION=$(node -p "require('./package.json').version")
echo "Current version: $VERSION"

# Check if already published
echo ""
echo "🔍 Checking if version already published..."
if npm view rhaone-orchestrator@$VERSION version &>/dev/null; then
    echo -e "${YELLOW}Warning: Version $VERSION already published${NC}"
    echo "Run npm version [patch|minor|major] first"
    exit 1
fi

# Run build
echo ""
echo "🔨 Building..."
./scripts/build.sh

# Verify files to be published
echo ""
echo "📦 Files to be published:"
npm pack --dry-run 2>&1 | grep -E "^npm notice|^\s+\d+"

if [ "$DRY_RUN" = true ]; then
    echo ""
    echo -e "${YELLOW}Dry run - not publishing${NC}"
    exit 0
fi

# Confirm publish
echo ""
read -p "Publish version $VERSION to NPM? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled"
    exit 0
fi

# Publish
echo ""
echo "🚀 Publishing..."
if [ -n "$TAG" ]; then
    npm publish --access public $TAG
    echo -e "${GREEN}✓ Published with tag: $TAG${NC}"
else
    npm publish --access public
    echo -e "${GREEN}✓ Published to NPM${NC}"
fi

# Create git tag
echo ""
echo "🏷️  Creating git tag..."
git tag -a "v$VERSION" -m "Release v$VERSION"
echo -e "${GREEN}✓ Created tag v$VERSION${NC}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Publish complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "  git push origin v$VERSION  - Push the tag"
echo "  gh release create v$VERSION - Create GitHub release"
echo ""
