#!/bin/bash
# Aeolus — Raspberry Pi Setup Script
# Run this on a fresh Raspbian installation
# Usage: curl -sSL https://raw.githubusercontent.com/j-a-m-i-e-c/aeolus/main/scripts/setup-pi.sh | bash

set -e

echo "🌬️  Aeolus — Raspberry Pi Setup"
echo "================================"

# 1. Set hostname to 'aeolus' for local network access (http://aeolus.local)
CURRENT_HOSTNAME=$(hostname)
if [ "$CURRENT_HOSTNAME" != "aeolus" ]; then
  echo "🏷️  Setting hostname to 'aeolus'..."
  sudo hostnamectl set-hostname aeolus
  # Update /etc/hosts so localhost resolution still works
  sudo sed -i "s/127\.0\.1\.1.*$CURRENT_HOSTNAME/127.0.1.1\taeolus/" /etc/hosts
  # Ensure avahi-daemon is installed and running for mDNS (.local resolution)
  if ! command -v avahi-daemon &> /dev/null; then
    echo "📦 Installing Avahi for mDNS..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq avahi-daemon
  fi
  sudo systemctl enable avahi-daemon
  sudo systemctl restart avahi-daemon
  echo "✓ Hostname set to 'aeolus' — reachable at http://aeolus.local"
else
  echo "✓ Hostname already set to 'aeolus'"
fi

# 2. Install Docker if not present
if ! command -v docker &> /dev/null; then
  echo "📦 Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  echo "✓ Docker installed"
else
  echo "✓ Docker already installed"
fi

# 3. Enable Docker to start on boot
echo "⚙️  Enabling Docker on boot..."
sudo systemctl enable docker
sudo systemctl start docker
echo "✓ Docker enabled on boot"

# 3b. Stop native Mosquitto if running (Docker will provide its own)
if systemctl is-active --quiet mosquitto 2>/dev/null; then
  echo "⚙️  Stopping native Mosquitto (Docker will provide MQTT broker)..."
  sudo systemctl stop mosquitto
  sudo systemctl disable mosquitto
  echo "✓ Native Mosquitto stopped and disabled"
fi

# 4. Install Docker Compose plugin if not present
if ! docker compose version &> /dev/null; then
  echo "📦 Installing Docker Compose..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-compose-plugin
  echo "✓ Docker Compose installed"
else
  echo "✓ Docker Compose already installed"
fi

# 5. Clone Aeolus
INSTALL_DIR="$HOME/aeolus"
if [ -d "$INSTALL_DIR" ]; then
  echo "📂 Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull
else
  echo "📂 Cloning Aeolus..."
  git clone https://github.com/j-a-m-i-e-c/aeolus.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 6. Create .env from example if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ Created .env from template"
fi

# 7. Build and start
echo "🔨 Building containers (this may take a few minutes on first run)..."
docker compose build
echo "🚀 Starting Aeolus..."
docker compose up -d

echo ""
echo "================================"
echo "🌬️  Aeolus is running!"
echo ""
echo "  Dashboard:  http://aeolus.local:3000"
echo "  Backend:    http://aeolus.local:3001"
echo "  MQTT:       aeolus.local:1883"
echo ""
echo "  IP address: $(hostname -I | awk '{print $1}')"
echo ""
echo "  Logs:       docker compose logs -f"
echo "  Stop:       docker compose down"
echo "  Restart:    docker compose restart"
echo ""
echo "  Aeolus will auto-start on boot."
echo "================================"
