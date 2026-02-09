#!/bin/bash
# Build Docker image for M1/M2/M3 (ARM64) architecture
# This script builds the image locally and tags it appropriately

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Building Moltbot Docker Image for M1${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Detect architecture
ARCH=$(uname -m)
echo -e "${BLUE}Detected architecture: ${YELLOW}${ARCH}${NC}"

if [ "$ARCH" != "arm64" ]; then
    echo -e "${YELLOW}Warning: This script is optimized for ARM64 (M1/M2/M3)${NC}"
    echo -e "${YELLOW}Current architecture is: ${ARCH}${NC}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Get tenant ID from command line or use default
TENANT=${1:-"10659588-3abb-4507-87ad-f6f3d2645a0b"}
IMAGE_NAME="paramita-cloud-${TENANT}-sandbox"
TAG="m1-$(date +%Y%m%d-%H%M%S)"

echo -e "${BLUE}Image name: ${GREEN}${IMAGE_NAME}${NC}"
echo -e "${BLUE}Tag: ${GREEN}${TAG}${NC}"
echo ""

# Build the image
echo -e "${BLUE}Building Docker image...${NC}"
docker build \
    --platform linux/arm64 \
    --build-arg TARGETARCH=arm64 \
    --build-arg BUILDPLATFORM=linux/arm64 \
    -t "${IMAGE_NAME}:${TAG}" \
    -t "${IMAGE_NAME}:m1-latest" \
    -f Dockerfile \
    .

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Build completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Image tags:"
echo -e "  - ${GREEN}${IMAGE_NAME}:${TAG}${NC}"
echo -e "  - ${GREEN}${IMAGE_NAME}:m1-latest${NC}"
echo ""
echo -e "To inspect the image:"
echo -e "  ${YELLOW}docker inspect ${IMAGE_NAME}:${TAG}${NC}"
echo ""
echo -e "To run locally:"
echo -e "  ${YELLOW}docker run -p 18789:18789 ${IMAGE_NAME}:${TAG}${NC}"
echo ""
echo -e "To push to Cloudflare registry:"
echo -e "  ${YELLOW}npx wrangler deploy --config wrangler.tenant-${TENANT}.jsonc${NC}"
echo ""
