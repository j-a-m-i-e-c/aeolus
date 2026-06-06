#!/bin/bash
# Build and deploy Aeolus with version info baked in
export BUILD_COMMIT=$(git rev-parse --short HEAD)
export BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "Building Aeolus @ ${BUILD_COMMIT} (${BUILD_DATE})"
docker compose down
docker compose up -d --build
