.PHONY: deploy up down restart logs status clean seed test lint check help

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

seed: ## Populate with demo data
	node scripts/seed-demo.mjs

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
