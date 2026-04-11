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

echo "✓ Deployed! Dashboard at http://$(hostname -I | awk '{print $1}'):3000"
