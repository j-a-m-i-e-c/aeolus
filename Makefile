.PHONY: deploy deploy-demo public-demo-preflight public-demo-build public-demo-up public-demo-seed public-demo-golden public-demo-reset up showcase showcase-reset showcase-seed public-demo-local public-demo-local-seed simulator-republish down restart logs logs-backend status clean dev sim seed-image seed reset test test-integration e2e e2e-fresh lint check verify verify-all help

# `USER` is normally set by the shell (your login name), which would leak into
# the seed command. Ignore the environment value and default to "admin" unless
# the caller passes USER=... explicitly on the command line.
ifeq ($(origin USER),environment)
USER := admin
endif

# Compose roles are intentionally explicit: root files are normal Aeolus; demo/compose
# contains showcase-only definitions. The hosted stack sets the repo root as the
# Compose project directory so .env, bind mounts and build contexts stay stable.
# Two local modes, not three products (showcase-cleanup §10):
#   base            = real Aeolus. What someone installing it for their own site gets.
#   SHOWCASE        = the same unrestricted app + simulated hardware + seeded showcase.
#   PUBLIC_DEMO     = SHOWCASE + anonymous visitor restrictions. Only for testing those.
# The public-demo overlay stacks ON TOP of the showcase one, so the simulator is
# defined once rather than described differently per file.
LOCAL_SHOWCASE_COMPOSE := --project-directory . -f docker-compose.yml -f demo/compose/local-showcase.yml
LOCAL_PUBLIC_DEMO_COMPOSE := $(LOCAL_SHOWCASE_COMPOSE) -f demo/compose/public-demo-local.yml
HOSTED_DEMO_COMPOSE := --project-directory . -f demo/compose/hosted-runtime.yml
HOSTED_DEMO_BUILD_COMPOSE := --project-directory . -f demo/compose/hosted-runtime.yml -f demo/compose/hosted-build.yml

# ─── Production / hosted release ─────────────────────────────────────────────

# BUILD_COMMIT/BUILD_DATE are build args consumed by the `backend` build in
# docker-compose.yml, so they must be set on the command that BUILDS (`up --build`),
# not on `down`. They are also resolved after `git pull`, so the stamp records the
# commit actually being deployed rather than the one that was checked out before.
deploy: ## Pull latest, rebuild, and deploy the BASE stack (run on Pi)
	git pull && \
	docker compose down && \
	BUILD_COMMIT=$$(git rev-parse --short HEAD) BUILD_DATE=$$(git log -1 --format=%cI HEAD) \
	docker compose up -d --build && \
	docker builder prune -f && docker image prune -f

deploy-demo: ## Deploy hardened public demo FROM THIS PC (no compilation on Lightsail)
	./demo/operations/deploy/deploy-from-pc.sh

public-demo-preflight: ## Check operator-PC prerequisites for Terraform + public demo deployment
	./demo/operations/deploy/preflight.sh

public-demo-build: ## Build hardened public-demo images locally (not on the VM)
	BUILD_COMMIT=$$(git rev-parse --short HEAD 2>/dev/null || echo local) BUILD_DATE=$$(date -u +%Y-%m-%dT%H:%M:%SZ) \
	docker compose $(HOSTED_DEMO_BUILD_COMPOSE) build backend frontend

public-demo-up: ## Start hardened public-demo stack using already-built/pulled images
	docker compose $(HOSTED_DEMO_COMPOSE) up -d --remove-orphans

public-demo-seed: ## Seed hardened public demo on this host. Usage: make public-demo-seed PASS=... [USER=admin]
	@if [ -z "$(PASS)" ]; then echo "Error: PASS is required"; exit 1; fi
	docker compose $(HOSTED_DEMO_COMPOSE) --profile seed run --rm -e SEED_USER="$(USER)" -e SEED_PASS="$(PASS)" seed

public-demo-golden: ## Create verified immutable golden snapshot (run on demo host)
	./demo/operations/create-golden.sh

public-demo-reset: ## Restore hardened public demo from golden snapshot (run on demo host)
	./demo/operations/reset.sh

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

showcase: ## Start real Aeolus + simulated hardware + showcase content (no visitor restrictions)
	docker compose $(LOCAL_SHOWCASE_COMPOSE) up -d --build
	@echo ""
	@echo "✅ Aeolus + Showcase is up: full unrestricted app with simulated hardware."
	@echo "   Normal login, normal admin, normal authoring. Seed the content with:"
	@echo "     make showcase-seed PASS=<admin-password>"

showcase-reset: ## Reset simulated hardware by restarting the simulator (it republishes initial state on reconnect)
	docker compose $(LOCAL_SHOWCASE_COMPOSE) restart simulator
	@echo "⏳ Waiting for the simulator to reconnect and republish initial state..."
	@sleep 6
	docker compose $(LOCAL_SHOWCASE_COMPOSE) logs --tail 20 simulator
	@echo "✅ Simulator reset. If the database was wiped, re-seed to reconfigure the command profiles: make showcase-seed PASS=<password>"

public-demo-local: ## Start the showcase PLUS anonymous visitor restrictions (for testing those restrictions)
	docker compose $(LOCAL_PUBLIC_DEMO_COMPOSE) up -d --build
	@echo ""
	@echo "✅ Public-demo mode is live locally. This is the showcase plus visitor"
	@echo "   restrictions — not the hardened hosted runtime. Seed the demo identity:"
	@echo "     make public-demo-local-seed PASS=<admin-password>"

dev: ## Start backend in dev mode (hot reload)
	npm run dev

sim: ## Start the demo MQTT simulator process (separate from the backend; off by default)
	@# Scenarios default to the showcase set (SHOWCASE_SCENARIO_KEYS in
	@# src/simulator/scenarios/index.ts). Override with AEOLUS_SIMULATOR_SCENARIOS=a,b.
	AEOLUS_SIMULATOR_ENABLED=true npm run sim

seed-image: ## Ensure the Node image the seeder runs in is present locally
	@if ! docker image inspect node:24.20.0-slim >/dev/null 2>&1; then \
		echo "Fetching the node:24.20.0-slim image the seeder runs in..."; \
		docker pull node:24.20.0-slim || { \
			echo ""; \
			echo "Error: could not pull node:24.20.0-slim, which the seeder runs in."; \
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

seed: ## Seed demo data via Docker, no host Node needed (usage: make seed PASS=yourpass [USER=admin])
	@if [ -z "$(PASS)" ]; then \
		echo "Error: PASS is required.  Usage: make seed PASS=<admin-password> [USER=admin]"; \
		exit 1; \
	fi
	@$(MAKE) --no-print-directory seed-image
	docker compose --profile seed run --rm -e SEED_USER="$(USER)" -e SEED_PASS="$(PASS)" seed

showcase-seed: ## Seed the showcase (needs make showcase running). Usage: make showcase-seed PASS=yourpass [USER=admin]
	@if [ -z "$(PASS)" ]; then \
		echo "Error: PASS is required.  Usage: make showcase-seed PASS=<admin-password> [USER=admin]"; \
		exit 1; \
	fi
	@$(MAKE) --no-print-directory seed-image
	@$(MAKE) --no-print-directory simulator-republish COMPOSE="$(LOCAL_SHOWCASE_COMPOSE)"
	docker compose $(LOCAL_SHOWCASE_COMPOSE) --profile seed run --rm -e SEED_USER="$(USER)" -e SEED_PASS="$(PASS)" seed

showcase-capture-layout: ## Capture the hand-arranged showcase layout into source (needs make showcase running). Usage: make showcase-capture-layout PASS=yourpass [USER=admin]
	@if [ -z "$(PASS)" ]; then \
		echo "Error: PASS is required.  Usage: make showcase-capture-layout PASS=<admin-password> [USER=admin]"; \
		exit 1; \
	fi
	@$(MAKE) --no-print-directory seed-image
	@# Same container and bind mount as the seeder, so the file it writes lands in the
	@# working tree rather than inside the container. Arrange the panes in the browser
	@# first, then read the diff before committing.
	docker compose $(LOCAL_SHOWCASE_COMPOSE) --profile seed run --rm \
		-e SEED_USER="$(USER)" -e SEED_PASS="$(PASS)" \
		--entrypoint sh seed -c \
		'node demo/operations/capture-showcase-layout.mjs http://localhost:$${API_PORT:-3001} "$$SEED_USER" "$$SEED_PASS"'

showcase-check-layout: ## Fail if the running showcase layout differs from the committed fixture. Usage: make showcase-check-layout PASS=yourpass
	@if [ -z "$(PASS)" ]; then \
		echo "Error: PASS is required.  Usage: make showcase-check-layout PASS=<admin-password> [USER=admin]"; \
		exit 1; \
	fi
	@$(MAKE) --no-print-directory seed-image
	docker compose $(LOCAL_SHOWCASE_COMPOSE) --profile seed run --rm \
		-e SEED_USER="$(USER)" -e SEED_PASS="$(PASS)" \
		--entrypoint sh seed -c \
		'node demo/operations/capture-showcase-layout.mjs --check http://localhost:$${API_PORT:-3001} "$$SEED_USER" "$$SEED_PASS"'

public-demo-local-seed: ## Seed the local public demo, incl. the demo identity (needs make public-demo-local). Usage: PASS=yourpass
	@if [ -z "$(PASS)" ]; then \
		echo "Error: PASS is required.  Usage: make public-demo-local-seed PASS=<admin-password> [USER=admin]"; \
		exit 1; \
	fi
	@$(MAKE) --no-print-directory seed-image
	@$(MAKE) --no-print-directory simulator-republish COMPOSE="$(LOCAL_PUBLIC_DEMO_COMPOSE)"
	docker compose $(LOCAL_PUBLIC_DEMO_COMPOSE) --profile seed run --rm -e SEED_USER="$(USER)" -e SEED_PASS="$(PASS)" seed

# Make the simulator republish before seeding, so the command-profile step is
# deterministic rather than a 30s gamble.
#
# The simulator publishes device state RETAINED, so the backend only learns about the
# simulated actuators when the simulator connects. After `docker compose down -v` the
# broker's retained store is gone too, so nothing would ever arrive on its own.
# --no-deps so this never quietly recreates the backend underneath a running stack.
simulator-republish:
	@echo "⏳ Making the simulator republish its device state before seeding..."
	docker compose $(COMPOSE) up -d --no-deps simulator
	docker compose $(COMPOSE) restart simulator
	@sleep 5

reset: ## Wipe database and restart fresh, BASE stack (deletes all data!)
	docker compose down -v
	docker compose up -d
	@echo "⏳ Waiting for backend to start..."
	@sleep 12
	@echo "✅ Fresh start (base stack). The seeder creates the admin itself:"
	@echo "     make seed PASS=yourpass"
	@echo "   Or visit http://localhost:3000 to create it by hand first."
	@echo "   For simulated hardware, use the showcase overlay instead: down -v dropped"
	@echo "   the simulator along with the broker's retained device state:"
	@echo "     make showcase && make showcase-seed PASS=yourpass"

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
