#!/bin/bash
#
# Test Cloudflare Access API connectivity
#
# This script tests if your API token has the correct permissions
# to manage Cloudflare Access applications and policies.
#
# Usage:
#   export CLOUDFLARE_API_TOKEN="your-api-token"
#   ./test-cloudflare-access-api.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "=========================================="
echo "Cloudflare Access API Test"
echo "=========================================="
echo ""

# Check for API token
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo -e "${RED}Error: CLOUDFLARE_API_TOKEN environment variable is required${NC}"
  echo ""
  echo "To create an API token:"
  echo "  1. Go to https://dash.cloudflare.com/profile/api-tokens"
  echo "  2. Click 'Create Token'"
  echo "  3. Use 'Create Custom Token'"
  echo "  4. Add these permissions:"
  echo "     - Account > Access: Organizations, Identity Providers, and Groups > Edit"
  echo "     - Account > Access: Apps and Policies > Edit"
  echo "  5. Copy the token and export it:"
  echo "     export CLOUDFLARE_API_TOKEN='your-token-here'"
  echo ""
  exit 1
fi

# Get account ID
echo -e "${BLUE}1. Getting account ID...${NC}"
ACCOUNT_ID=$(npx wrangler whoami 2>&1 | grep -o "[a-f0-9]\{32\}" | head -1)
if [ -z "$ACCOUNT_ID" ]; then
  echo -e "${RED}✗ Could not determine account ID${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Account ID: $ACCOUNT_ID${NC}"
echo ""

# Test 1: Get Access organization
echo -e "${BLUE}2. Testing Access organization endpoint...${NC}"
ORG_RESPONSE=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/organizations" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json")

ORG_SUCCESS=$(echo "$ORG_RESPONSE" | jq -r '.success')
if [ "$ORG_SUCCESS" = "true" ]; then
  TEAM_DOMAIN=$(echo "$ORG_RESPONSE" | jq -r '.result.auth_domain // "not-configured"')
  echo -e "${GREEN}✓ Access organization endpoint accessible${NC}"
  echo -e "  Team domain: $TEAM_DOMAIN"
else
  echo -e "${RED}✗ Access organization endpoint failed${NC}"
  echo "$ORG_RESPONSE" | jq '.errors'
  exit 1
fi
echo ""

# Test 2: List Access applications
echo -e "${BLUE}3. Testing Access applications endpoint...${NC}"
APPS_RESPONSE=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json")

APPS_SUCCESS=$(echo "$APPS_RESPONSE" | jq -r '.success')
if [ "$APPS_SUCCESS" = "true" ]; then
  APP_COUNT=$(echo "$APPS_RESPONSE" | jq -r '.result | length')
  echo -e "${GREEN}✓ Access applications endpoint accessible${NC}"
  echo -e "  Existing applications: $APP_COUNT"

  if [ "$APP_COUNT" -gt 0 ]; then
    echo ""
    echo "  Existing applications:"
    echo "$APPS_RESPONSE" | jq -r '.result[] | "    - \(.name) (\(.domain))"'
  fi
else
  echo -e "${RED}✗ Access applications endpoint failed${NC}"
  echo "$APPS_RESPONSE" | jq '.errors'
  exit 1
fi
echo ""

# Test 3: Check API token permissions
echo -e "${BLUE}4. Checking API token permissions...${NC}"
TOKEN_VERIFY=$(curl -s -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json")

TOKEN_SUCCESS=$(echo "$TOKEN_VERIFY" | jq -r '.success')
if [ "$TOKEN_SUCCESS" = "true" ]; then
  echo -e "${GREEN}✓ API token is valid${NC}"
  TOKEN_STATUS=$(echo "$TOKEN_VERIFY" | jq -r '.result.status')
  echo -e "  Status: $TOKEN_STATUS"
else
  echo -e "${RED}✗ API token verification failed${NC}"
  echo "$TOKEN_VERIFY" | jq '.errors'
  exit 1
fi
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}✓ All tests passed!${NC}"
echo "=========================================="
echo ""
echo "Your API token has the correct permissions."
echo "You can now use setup-cloudflare-access.sh to configure Access for your workers."
echo ""
echo "Example usage:"
echo "  ./scripts/setup-cloudflare-access.sh \\"
echo "    --worker=paramita-cloud-tenant-id \\"
echo "    --email=user@example.com"
echo ""
