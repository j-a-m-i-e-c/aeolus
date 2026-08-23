.PHONY: deploy deploy-demo public-demo-preflight public-demo-build public-demo-up public-demo-seed public-demo-golden public-demo-reset up up-desktop demo-up demo-reset down restart logs logs-backend status clean dev sim seed seed-demo reset test test-integration e2e e2e-fresh lint check verify verify-all help

# `USER` is normally set by the shell (your login name), which would leak into
# the seed command. Ignore the environment value and default to "admin" unless
# the caller passes USER=... explicitly on the command line.
ifeq ($(origin USER),environment)
USER := admin
endif

# Local development/demo overlay. This is NOT the hardened internet-facing stack.
DEMO_COMPOSE := -f docker-compose.yml -f docker-compose.demo.yml

# Hardened internet-facing stack. Production hosts consume pre-built images; the
# build overlay is opt-in for a developer/CI machine only.
PUBLIC_DEMO_COMPOSE := -f docker-compose.public-demo.yml
PUBLIC_DEMO_BUILD_COMPOSE := -f docker-compose.public-demo.yml -f docker-compose.public-demo.build.yml

# ─── Production / hosted release ─────────────────────────────────────────────

deploy: ## Pull latest, rebuild, and deploy the BASE stack (run on Pi)
	git pull && \
	BUILD_COMMIT=$$(git rev-parse --short HEAD) BUILD_DATE=$$(git log -1 --format=%cI HEAD) \
	docker compose down && docker compose up -d --build && docker builder prune -f && docker image prune -f

deploy-demo: ## Deploy hardened public demo FROM THIS PC (no compilation on Lightsail)
	./scripts/deploy/deploy-demo-from-pc.sh

public-demo-preflight: ## Check operator-PC prerequisites for Terraform + public demo deployment
	./scripts/deploy/check-public-demo-prereqs.sh

public-demo-build: ## Build hardened public-demo images locally (not on the VM)
	BUILD_COMMIT=$$(git rev-parse --short HEAD 2>/dev/null || echo local) BUILD_DATE=$$(date -u +%Y-%m-%dT%H:%M:%SZ) \
	docker compose $(PUBLIC_DEMO_BUILD_COMPOSE) build backend frontend

public-demo-up: ## Start hardened public-demo stack using already-built/pulled images
	docker compose $(PUBLIC_DEMO_COMPOSE) up -d --remove-orphans

public-demo-seed: ## Seed hardened public demo on this host. Usage: make public-demo-seed PASS=... [USER=admin]
	@if [ -z "$(PASS)" ]; then echo "Error: PASS is required"; exit 1; fi
	docker compose $(PUBLIC_DEMO_COMPOSE) --profile seed run --rm -e SEED_USER="$(USER)" -e SEED_PASS="$(PASS)" seed

public-demo-golden: ## Create verified immutable golden snapshot (run on demo host)
	./scripts/create-demo-golden.sh

public-demo-reset: ## Restore hardened public demo from golden snapshot (run on demo host)
	./scripts/reset-demo.sh

up: ## Start all services
	docker compose up -d

down: ## Stop all services
	docker compose down

restart: ## Restart all services
	docker compose restart

logs: ## Tail logs from all services
	docker compose logs -f --tail 100

logs-backend: ## Tail backend logs only
	docker compose logs -f --tail 100 backend

status: ## Show running containers
	docker compose ps

clean: ## Remove unused Docker images and build cache (does NOT touch volumes/data)
	docker builder prune -f && docker image prune -a -f

# ─── Development ──────────────────────────────────────────────────────────────

up-desktop: ## Start all services with the opt-in desktop/dev bridge override (Docker Desktop)
	docker compose -f docker-compose.yml -f docker-compose.desktop.yml up -d --build

demo-up: ## Start the public demo overlay (backend demo mode + Phase 2 simulator)
	docker compose $(DEMO_COMPOSE) up -d --build

demo-reset: ## Reset simulated hardware by restarting the simulator (it republishes initial state on reconnect)
	docker compose $(DEMO_COMPOSE) restart simulator
	@echo "⏳ Waiting for the simulator to reconnect and republish initial state..."
	@sleep 6
	docker compose $(DEMO_COMPOSE) logs --tail 20 simulator
	@echo "✅ Simulator reset. If the database was wiped, re-run the seed with the demo overlay to reconfigure command profiles (AEOLUS_SIMULATOR_BOOTSTRAP=true)."

dev: ## Start backend in dev mode (hot reload)
	npm run dev

sim: ## Start the demo MQTT simulator process (separate from the backend; off by default)
	AEOLUS_SIMULATOR_ENABLED=true AEOLUS_SIMULATOR_SCENARIOS=agriculture,research-vessel,underground-mining,wildlife,stage-show,escape-room,off-grid-bunker npm run sim

seed: ## Seed demo data via Docker, no host Node needed (usage: make seed PASS=yourpass [USER=admin])
	@if [ -z "$(PASS)" ]; then \
		echo "Error: PASS is required.  Usage: make seed PASS=<admin-password> [USER=admin]"; \
		exit 1; \
	fi
	@if ! docker image inspect node:22.22.1-slim >/dev/null 2>&1; then \
		echo "Fetching the node:22.22.1-slim image the seeder runs in..."; \
		docker pull node:22.22.1-slim || { \
			echo ""; \
			echo "Error: could not pull node:22.22.1-slim, which the seeder runs in."; \
			echo "This is almost always a host DNS/connectivity problem, not an Aeolus issue."; \
			echo "Fix and retry:"; \
			echo "  1. Test DNS:  docker run --rm busybox nslookup production.cloudfront.docker.com"; \
			echo "  2. If that fails, set Docker DNS in /etc/docker/daemon.json:"; \
			echo "         { \"dns\": [\"1.1.1.1\", \"8.8.8.8\"] }"; \
			echo "     then restart Docker:  sudo systemctl restart docker"; \
			echo "  3. Re-run:  make seed PASS=... [USER=...]"; \
			echo ""; \
			echo "Note: seeding only adds demo data. You can instead create your admin"; \
			echo "at http://<host>:3000 (first-run Setup page) without seeding at all."; \
			exit 1; \
		}; \
	fi
	docker compose --profile seed run --rm -e SEED_USER="$(USER)" -e SEED_PASS="$(PASS)" seed

seed-demo: ## Seed the PUBLIC DEMO (adds demo identity + configures simulator command profiles). Usage: make seed-demo PASS=yourpass [USER=admin]
	@if [ -z "$(PASS)" ]; then \
		echo "Error: PASS is required.  Usage: make seed-demo PASS=<admin-password> [USER=admin]"; \
		exit 1; \
	fi
	docker compose $(DEMO_COMPOSE) --profile seed run --rm -e SEED_USER="$(USER)" -e SEED_PASS="$(PASS)" seed

reset: ## Wipe database and restart fresh (deletes all data!)
	docker compose down -v
	docker compose up -d
	@echo "⏳ Waiting for backend to start..."
	@sleep 12
	@echo "✅ Fresh start. Visit http://localhost:3000 to create admin, then run: make seed PASS=yourpass"

test: ## Run backend + frontend suites WITH coverage (mirrors CI's coverage thresholds)
	npx vitest run --coverage
	cd frontend && npm run test:coverage

test-integration: ## Run broker-backed integration tests (needs Docker; self-skips without it)
	docker pull eclipse-mosquitto:2
	npx vitest run __integration__ --no-file-parallelism

e2e: ## Run Playwright e2e against the running stack (adapts: sets up or logs in)
	npm run test:e2e

e2e-fresh: ## Wipe data, rebuild the stack, and run e2e (exercises the first-run setup path)
	docker compose down -v
	docker compose up -d --build
	npm run test:e2e

lint: ## Run ESLint across the repo — backend TS + frontend TSX, zero-warning gate
	npx eslint . --max-warnings 0

check: ## TypeScript type check, backend + frontend (no emit)
	npx tsc --noEmit
	cd frontend && npx tsc --noEmit -p tsconfig.json

verify: check lint test ## Full local gate — type check + lint + tests with coverage (mirrors CI: lint, backend, frontend)
verify-all: verify test-integration ## verify + broker-backed integration tests — the complete CI mirror (needs Docker)

# ─── Help ─────────────────────────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
