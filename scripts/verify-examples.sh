#!/bin/bash
# Verify example scripts compile correctly

set -e

echo "🦞 Rhaone Orchestrator - Verify Examples"
echo "========================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if TypeScript is available
if ! command -v npx &> /dev/null; then
    echo -e "${RED}Error: npx not found${NC}"
    exit 1
fi

# Build the project first
echo ""
echo "🔨 Building project..."
npm run build

# Verify examples compile
echo ""
echo "🔍 Verifying example scripts..."

EXAMPLES_DIR="examples/scripts"
FAILED=0
PASSED=0

# Function to check a TypeScript file
check_file() {
    local file=$1
    echo -n "  Checking $(basename $file)... "

    if npx tsc --noEmit --skipLibCheck "$file" 2>/dev/null; then
        echo -e "${GREEN}✓${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC}"
        ((FAILED++))
    fi
}

# Check all TypeScript files
for category in basic advanced custom; do
    if [ -d "$EXAMPLES_DIR/$category" ]; then
        echo ""
        echo "📁 $category/"
        for file in "$EXAMPLES_DIR/$category"/*.ts; do
            if [ -f "$file" ]; then
                check_file "$file"
            fi
        done
    fi
done

# Summary
echo ""
echo "========================================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All examples verified ($PASSED passed)${NC}"
    exit 0
else
    echo -e "${RED}✗ Some examples failed ($PASSED passed, $FAILED failed)${NC}"
    exit 1
fi
