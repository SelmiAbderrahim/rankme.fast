# RankMeFast — Docker control plane.
# All targets run through `docker compose` against the `rankme` project
# (project name is set via `name:` in docker-compose.yml). Config comes from
# the root .env. Run `make help` for the target list.

SHELL := /bin/bash
COMPOSE := docker compose

# Overall timeout (seconds) for `wait-healthy` before it gives up.
HEALTH_TIMEOUT ?= 300

# Database backup/restore (logical dumps into $(BACKUP_DIR)/).
BACKUP_DIR   ?= backup
MONGO_DB     ?= rankme
REDIS_VOLUME ?= rankme_redis-data

.DEFAULT_GOAL := help
.PHONY: help build up build-up deploy down stop restart ps logs health \
        wait-healthy config sh-api sh-web pull test test-server test-client \
        backup restore

help: ## Show this help
	@echo "RankMeFast — make targets:"
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

build: ## Build all service images
	$(COMPOSE) build

up: ## Start the stack (detached), then wait until all containers are healthy
	$(COMPOSE) up -d
	@$(MAKE) --no-print-directory wait-healthy

build-up: ## Build + start the whole stack (detached), then wait until all containers are healthy
	$(COMPOSE) up -d --build
	@$(MAKE) --no-print-directory wait-healthy

deploy: build-up ## Alias for build-up

down: ## Stop and remove containers (volumes are PRESERVED)
	$(COMPOSE) down

stop: ## Stop containers without removing them
	$(COMPOSE) stop

restart: ## Restart all services
	$(COMPOSE) restart

ps: ## Show container status
	$(COMPOSE) ps

logs: ## Follow logs from all services (last 100 lines)
	$(COMPOSE) logs -f --tail=100

pull: ## Pull the latest base images used by the Compose stack
	$(COMPOSE) pull

config: ## Validate compose file + .env interpolation
	$(COMPOSE) config

health: ## Print each service's health state once
	@$(COMPOSE) ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'

# Block until every required service reports state=running and health=healthy.
# Fails fast on terminal/restarting states and gives up after
# $(HEALTH_TIMEOUT) seconds. The explicit service list prevents a missing
# Compose service from silently shrinking the release gate.
wait-healthy: ## Wait until all containers report healthy (fails on unhealthy/exit/timeout)
	@echo "Waiting for all containers to become healthy (timeout $(HEALTH_TIMEOUT)s)..."
	@deadline=$$(( $$(date +%s) + $(HEALTH_TIMEOUT) )); \
	required_services="api worker web mongo postgres redis"; \
	while true; do \
		pending=0; failed=0; summary=""; \
		for service in $$required_services; do \
			id=$$($(COMPOSE) ps -q "$$service"); \
			if [ -z "$$id" ]; then \
				summary="$$summary  $$service: missing\n"; failed=1; continue; \
			fi; \
			name=$$(docker inspect -f '{{.Name}}' $$id | sed 's#^/##'); \
			state=$$(docker inspect -f '{{.State.Status}}' $$id); \
			health=$$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $$id); \
			summary="$$summary  $$name: state=$$state health=$$health\n"; \
			if [ "$$state" = "exited" ] || [ "$$state" = "dead" ] || [ "$$state" = "restarting" ] || [ "$$health" = "unhealthy" ]; then failed=1; fi; \
			if [ "$$state" != "running" ] || [ "$$health" != "healthy" ]; then pending=1; fi; \
		done; \
		if [ "$$failed" = "1" ]; then \
			echo "A required service is missing, unhealthy, exited, dead, or restarting:"; echo -e "$$summary"; \
			echo "Recent logs:"; $(COMPOSE) ps; exit 1; \
		fi; \
		if [ "$$pending" = "0" ]; then \
			echo "All containers healthy:"; echo -e "$$summary"; exit 0; \
		fi; \
		if [ $$(date +%s) -ge $$deadline ]; then \
			echo "Timed out after $(HEALTH_TIMEOUT)s waiting for health:"; echo -e "$$summary"; exit 1; \
		fi; \
		sleep 5; \
	done

sh-api: ## Open a shell in the running api container
	$(COMPOSE) exec api sh

sh-web: ## Open a shell in the running web container
	$(COMPOSE) exec web sh

# Run the full test suite (server + client) on the host via vitest in
# single-run mode. Fails the whole target if either suite has a failing test.
test: test-server test-client ## Run all tests (server + client)

test-server: ## Run server tests (vitest, single run)
	cd server && npx vitest run

test-client: ## Run client tests (vitest, single run)
	cd client && npx vitest run

# Dump all three datastores into $(BACKUP_DIR)/ while the stack stays up.
# Logical dumps: portable, per-engine files. `-T` on `exec` disables the TTY
# so stdout redirection works. Overwrites previous dumps on each run.
backup: ## Dump all databases (postgres, mongo, redis) into $(BACKUP_DIR)/
	@mkdir -p $(BACKUP_DIR)
	@echo "==> Postgres -> $(BACKUP_DIR)/postgres.dump"
	@$(COMPOSE) exec -T postgres pg_dump -U $${POSTGRES_USER:-rankme} -Fc $${POSTGRES_DB:-rankme} > $(BACKUP_DIR)/postgres.dump
	@echo "==> Mongo    -> $(BACKUP_DIR)/mongo.archive.gz"
	@$(COMPOSE) exec -T mongo mongodump --db=$(MONGO_DB) --archive --gzip > $(BACKUP_DIR)/mongo.archive.gz
	@echo "==> Redis    -> $(BACKUP_DIR)/redis.rdb"
	@$(COMPOSE) exec -T redis redis-cli SAVE >/dev/null
	@$(COMPOSE) exec -T redis cat /data/dump.rdb > $(BACKUP_DIR)/redis.rdb
	@echo "Backup complete -> $(BACKUP_DIR)/"

# DESTRUCTIVE: overwrites the current databases with the dumps in
# $(BACKUP_DIR)/. Redis needs a restart because AOF is enabled — a running
# server can't hot-load an RDB, so we stop redis, swap dump.rdb into the
# volume, clear the AOF dir, and start it (redis bootstraps from the RDB,
# then rebuilds AOF).
restore: ## Restore all databases from $(BACKUP_DIR)/ (DESTRUCTIVE — overwrites current data)
	@echo "!! DESTRUCTIVE: overwriting current databases from $(BACKUP_DIR)/"
	@echo "==> Postgres restore"
	@$(COMPOSE) exec -T postgres pg_restore -U $${POSTGRES_USER:-rankme} -d $${POSTGRES_DB:-rankme} --clean --if-exists --no-owner < $(BACKUP_DIR)/postgres.dump
	@echo "==> Mongo restore"
	@$(COMPOSE) exec -T mongo mongorestore --archive --gzip --drop < $(BACKUP_DIR)/mongo.archive.gz
	@echo "==> Redis restore (brief redis restart)"
	@$(COMPOSE) stop redis
	@docker run --rm -v $(REDIS_VOLUME):/data -v $(PWD)/$(BACKUP_DIR):/backup:ro alpine:3 \
		sh -c 'rm -rf /data/appendonlydir /data/dump.rdb && cp /backup/redis.rdb /data/dump.rdb'
	@$(COMPOSE) start redis
	@echo "Restore complete from $(BACKUP_DIR)/"
