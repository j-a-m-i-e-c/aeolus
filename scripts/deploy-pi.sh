#!/bin/bash
# Aeolus — Pull latest changes and redeploy on Pi
# Run from the Pi: ~/aeolus/scripts/deploy-pi.sh

set -e
cd "$(dirname "$0")/.."

echo "🌬️  Pulling latest changes..."
git pull

echo "🔨 Rebuilding containers..."
docker compose build

echo "🚀 Restarting services..."
docker compose up -d

echo "🧹 Cleaning up old Docker images and build cache..."
docker system prune -f --filter "until=24h" > /dev/null 2>&1 || true

echo "✓ Deployed! Dashboard at http://aeolus.local:3000"
