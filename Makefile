.PHONY: deploy up down restart logs status clean seed test lint check help

# `USER` is normally set by the shell (your login name), which would leak into
# the seed command. Ignore the environment value and default to "admin" unless
# the caller passes USER=... explicitly on the command line.
ifeq ($(origin USER),environment)
USER := admin
endif

# ─── Production (Pi) ──────────────────────────────────────────────────────────

deploy: ## Pull latest, rebuild, and deploy (run on Pi)
	git pull && docker compose down && docker compose up -d --build && docker builder prune -f && docker image prune -f

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

clean: ## Remove all unused Docker images and build cache
	docker builder prune -f && docker image prune -a -f && docker volume prune -f

# ─── Development ──────────────────────────────────────────────────────────────

dev: ## Start backend in dev mode (hot reload)
	npm run dev

seed: ## Seed demo data via Docker, no host Node needed (usage: make seed PASS=yourpass [USER=admin])
	@if [ -z "$(PASS)" ]; then \
		echo "Error: PASS is required.  Usage: make seed PASS=<admin-password> [USER=admin]"; \
		exit 1; \
	fi
	docker compose --profile seed run --rm -e SEED_USER="$(USER)" -e SEED_PASS="$(PASS)" seed

reset: ## Wipe database and restart fresh (deletes all data!)
	docker compose down -v
	docker compose up -d
	@echo "⏳ Waiting for backend to start..."
	@sleep 12
	@echo "✅ Fresh start. Visit http://localhost:3000 to create admin, then run: make seed PASS=yourpass"

test: ## Run test suite
	npm test

lint: ## Run ESLint
	npx eslint .

check: ## TypeScript type check (no emit)
	npx tsc --noEmit

# ─── Help ─────────────────────────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
