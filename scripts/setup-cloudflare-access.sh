#!/bin/bash
#
# Setup Cloudflare Access for a Worker
#
# This script automates the process of:
# 1. Creating a Cloudflare Access application for a worker
# 2. Creating an access policy (e.g., allow specific emails)
# 3. Returning the Application Audience (AUD) tag
#
# Usage:
#   export CLOUDFLARE_API_TOKEN="your-api-token"
#   ./setup-cloudflare-access.sh --worker=paramita-cloud-tenant-id --email=user@example.com
#
# Required API Token Permissions:
#   - Account > Access: Organizations, Identity Providers, and Groups > Edit
#   - Account > Access: Apps and Policies > Edit
#
# API Documentation:
#   https://developers.cloudflare.com/api/operations/access-applications-add-an-access-application
#   https://developers.cloudflare.com/api/operations/access-policies-create-an-access-policy

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
WORKER_NAME=""
ALLOWED_EMAIL=""
TEAM_DOMAIN=""

for arg in "$@"; do
  case $arg in
    --worker=*)
      WORKER_NAME="${arg#*=}"
      shift
      ;;
    --email=*)
      ALLOWED_EMAIL="${arg#*=}"
      shift
      ;;
    --team-domain=*)
      TEAM_DOMAIN="${arg#*=}"
      shift
      ;;
    --help)
      echo "Usage: $0 --worker=WORKER_NAME --email=EMAIL [--team-domain=DOMAIN]"
      echo ""
      echo "Options:"
      echo "  --worker=NAME         Worker name (e.g., paramita-cloud-tenant-id)"
      echo "  --email=EMAIL         Email address to allow access"
      echo "  --team-domain=DOMAIN  Your Cloudflare Access team domain (optional)"
      echo ""
      echo "Environment variables:"
      echo "  CLOUDFLARE_API_TOKEN  Your Cloudflare API token (required)"
      exit 0
      ;;
    *)
      ;;
  esac
done

# Validate inputs
if [ -z "$WORKER_NAME" ]; then
  echo -e "${RED}Error: --worker is required${NC}"
  echo "Usage: $0 --worker=WORKER_NAME --email=EMAIL"
  exit 1
fi

if [ -z "$ALLOWED_EMAIL" ]; then
  echo -e "${RED}Error: --email is required${NC}"
  echo "Usage: $0 --worker=WORKER_NAME --email=EMAIL"
  exit 1
fi

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo -e "${RED}Error: CLOUDFLARE_API_TOKEN environment variable is required${NC}"
  echo ""
  echo "Get your API token from: https://dash.cloudflare.com/profile/api-tokens"
  echo ""
  echo "Required permissions:"
  echo "  - Account > Access: Organizations, Identity Providers, and Groups > Edit"
  echo "  - Account > Access: Apps and Policies > Edit"
  exit 1
fi

# Get account ID from wrangler
echo -e "${BLUE}Getting Cloudflare account ID...${NC}"
ACCOUNT_ID=$(npx wrangler whoami 2>&1 | grep -o "[a-f0-9]\{32\}" | head -1)
if [ -z "$ACCOUNT_ID" ]; then
  echo -e "${RED}Error: Could not determine account ID${NC}"
  exit 1
fi
echo -e "${GREEN}Account ID: $ACCOUNT_ID${NC}"

# Get worker URL
WORKER_URL="${WORKER_NAME}.workers.dev"
echo -e "${BLUE}Worker URL: $WORKER_URL${NC}"

# Get team domain if not provided
if [ -z "$TEAM_DOMAIN" ]; then
  echo ""
  echo -e "${YELLOW}Fetching Access team domain...${NC}"
  TEAM_RESPONSE=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/organizations" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json")

  TEAM_DOMAIN=$(echo "$TEAM_RESPONSE" | jq -r '.result.auth_domain // empty')

  if [ -z "$TEAM_DOMAIN" ]; then
    echo -e "${RED}Error: Could not fetch team domain. You may need to set up Cloudflare Access first.${NC}"
    echo "Response: $TEAM_RESPONSE"
    exit 1
  fi
  echo -e "${GREEN}Team domain: $TEAM_DOMAIN${NC}"
fi

echo ""
echo "=========================================="
echo "Cloudflare Access Setup"
echo "=========================================="
echo "Worker:       $WORKER_NAME"
echo "URL:          https://$WORKER_URL"
echo "Allow email:  $ALLOWED_EMAIL"
echo "Team domain:  $TEAM_DOMAIN"
echo "=========================================="
echo ""

# Check if application already exists
echo -e "${BLUE}Checking for existing Access application...${NC}"
EXISTING_APPS=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json")

APP_ID=$(echo "$EXISTING_APPS" | jq -r ".result[] | select(.domain == \"$WORKER_URL\") | .id // empty")

if [ -n "$APP_ID" ]; then
  echo -e "${YELLOW}Access application already exists (ID: $APP_ID)${NC}"

  # Get existing AUD
  APP_DETAILS=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps/$APP_ID" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json")

  AUD=$(echo "$APP_DETAILS" | jq -r '.result.aud // empty')

  echo ""
  echo -e "${GREEN}✓ Application already configured${NC}"
  echo -e "${GREEN}Application Audience (AUD): $AUD${NC}"
  echo ""
  echo "To update the policy, delete the existing application first or modify it manually."
  exit 0
fi

# Create Access Application
echo -e "${BLUE}Creating Access application...${NC}"

APP_PAYLOAD=$(cat <<EOF
{
  "name": "$WORKER_NAME Access",
  "domain": "$WORKER_URL",
  "type": "self_hosted",
  "session_duration": "24h",
  "auto_redirect_to_identity": false,
  "allowed_idps": [],
  "cors_headers": {
    "allow_all_origins": true,
    "allow_all_methods": true,
    "allow_all_headers": true,
    "allow_credentials": true
  }
}
EOF
)

APP_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$APP_PAYLOAD")

# Check if successful
SUCCESS=$(echo "$APP_RESPONSE" | jq -r '.success')
if [ "$SUCCESS" != "true" ]; then
  echo -e "${RED}Error creating Access application:${NC}"
  echo "$APP_RESPONSE" | jq '.'
  exit 1
fi

APP_ID=$(echo "$APP_RESPONSE" | jq -r '.result.id')
AUD=$(echo "$APP_RESPONSE" | jq -r '.result.aud')

echo -e "${GREEN}✓ Access application created${NC}"
echo -e "${GREEN}Application ID: $APP_ID${NC}"
echo -e "${GREEN}Application Audience (AUD): $AUD${NC}"

# Create Access Policy (Allow specific email)
echo ""
echo -e "${BLUE}Creating Access policy (allow $ALLOWED_EMAIL)...${NC}"

POLICY_PAYLOAD=$(cat <<EOF
{
  "name": "Allow $ALLOWED_EMAIL",
  "decision": "allow",
  "include": [
    {
      "email": {
        "email": "$ALLOWED_EMAIL"
      }
    }
  ],
  "precedence": 1,
  "session_duration": "24h"
}
EOF
)

POLICY_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$POLICY_PAYLOAD")

# Check if successful
SUCCESS=$(echo "$POLICY_RESPONSE" | jq -r '.success')
if [ "$SUCCESS" != "true" ]; then
  echo -e "${RED}Error creating Access policy:${NC}"
  echo "$POLICY_RESPONSE" | jq '.'
  exit 1
fi

POLICY_ID=$(echo "$POLICY_RESPONSE" | jq -r '.result.id')

echo -e "${GREEN}✓ Access policy created${NC}"
echo -e "${GREEN}Policy ID: $POLICY_ID${NC}"

# Summary
echo ""
echo "=========================================="
echo -e "${GREEN}✓ Cloudflare Access Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Configuration details:"
echo "  Worker URL:        https://$WORKER_URL"
echo "  Team Domain:       $TEAM_DOMAIN"
echo "  Application AUD:   $AUD"
echo "  Allowed Email:     $ALLOWED_EMAIL"
echo ""
echo "Next steps:"
echo "  1. Set these secrets in your Worker:"
echo "     CF_ACCESS_TEAM_DOMAIN=$TEAM_DOMAIN"
echo "     CF_ACCESS_AUD=$AUD"
echo ""
echo "  2. Test access by visiting:"
echo "     https://$WORKER_URL"
echo ""
echo "  3. You should be prompted to authenticate with your email"
echo ""
