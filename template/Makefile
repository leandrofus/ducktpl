# DuckApp — top-level build.
#
#   make dev       gateway + UI with hot reload
#   make build     one binary with the UI inside, into dist/bin
#   make generate  after changing SQL or an API comment
#   make help      everything

VERSION ?= $(shell git describe --tags --abbrev=0 2>/dev/null || echo 0.1.0)
DIST    := dist
BIN     := $(DIST)/bin

.DEFAULT_GOAL := help
.PHONY: help dev dev-gateway dev-web build web gateway generate test test-go test-web test-postgres dist clean \
        postgres postgres-stop
# duck:if pam
.PHONY: build-pam
# duck:end
# duck:if redis
.PHONY: redis redis-stop test-redis
# duck:end
# duck:if s3
.PHONY: minio minio-stop test-s3
# duck:end
# duck:if site
.PHONY: site site-dev
# duck:end

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[1m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---- develop ----

dev: ## Gateway (first free port from :8080, or DUCKAPP_PORT) and Vite on :5173 (proxying /api); HOST=0.0.0.0 to reach it from the network
	dev/run.sh

dev-gateway: ## Only the gateway (go run), with the data in .dev/
	mkdir -p .dev && cd gateway && DUCKAPP_DB=../.dev/duckapp.db go run ./cmd/duckapp

dev-web: ## Only the UI dev server (needs a gateway on :8080)
	cd web && bun run dev

# ---- build ----

build: web gateway ## Compile the UI and the gateway into dist/bin
	@mkdir -p $(BIN)
	cp gateway/bin/duckapp $(BIN)/
	@ls -lh $(BIN)

web: ## UI into gateway/internal/server/ui/dist (embedded)
	$(MAKE) -C gateway web

gateway: ## The gateway binary (static, CGO off)
	$(MAKE) -C gateway build VERSION=$(VERSION)

# duck:if pam
build-pam: web ## The gateway with PAM (needs gcc and libpam0g-dev / pam-devel)
	@mkdir -p $(BIN)
	cd gateway && CGO_ENABLED=1 go build -trimpath -tags pam -ldflags "-s -w -X main.version=$(VERSION)" -o ../$(BIN)/duckapp ./cmd/duckapp
# duck:end

generate: ## Regenerate sqlc code, the OpenAPI spec and the UI's API types
	$(MAKE) -C gateway generate openapi
	cd web && bun run gen-api

# ---- check ----

test: test-go test-web ## Vet, test, check generated code is current, typecheck the UI

test-go:
	cd gateway && go vet ./... && go test ./... && go run ./cmd/openapi-gen -check

test-web:
	cd web && bun install --frozen-lockfile
	@# regenerated types must equal the file on disk (not the git index: uncommitted work is fine)
	cd web && cp src/lib/api-types.ts .api-types.prev && bun run gen-api && diff -u .api-types.prev src/lib/api-types.ts; rc=$$?; rm -f .api-types.prev; exit $$rc
	cd web && bun run typecheck

# Runs a throwaway container (docker or podman) unless one is already up.
CONTAINER := $(shell command -v docker || command -v podman)

POSTGRES_URL := postgres://duckapp:duckapp@127.0.0.1:25432/duckapp?sslmode=disable
test-postgres: ## The gateway suites again on PostgreSQL (each test in its own schema)
	@started=; if ! $(CONTAINER) exec duckapp-postgres pg_isready -q -h 127.0.0.1 2>/dev/null; then $(MAKE) -s postgres && started=1; fi; \
	cd gateway && DUCKAPP_TEST_POSTGRES='$(POSTGRES_URL)' go test -count=1 ./internal/...; rc=$$?; \
	cd .. && if [ -n "$$started" ]; then $(MAKE) -s postgres-stop; fi; exit $$rc

postgres: ## Start PostgreSQL for development (DUCKAPP_DB=$(POSTGRES_URL))
	$(CONTAINER) run -d --rm --name duckapp-postgres -p 25432:5432 -e POSTGRES_USER=duckapp -e POSTGRES_PASSWORD=duckapp -e POSTGRES_DB=duckapp postgres:17-alpine >/dev/null
	@# over TCP: during initdb the image runs a socket-only server that pg_isready would accept
	@until $(CONTAINER) exec duckapp-postgres pg_isready -q -h 127.0.0.1 2>/dev/null; do sleep 0.5; done; echo "postgres: $(POSTGRES_URL)"

postgres-stop: ## Stop PostgreSQL
	-$(CONTAINER) stop duckapp-postgres >/dev/null

# duck:if redis
redis: ## Start Redis for development (DUCKAPP_REDIS=redis://127.0.0.1:26379/0)
	$(CONTAINER) run -d --rm --name duckapp-redis -p 26379:6379 redis:7-alpine >/dev/null && echo "redis: redis://127.0.0.1:26379/0"

redis-stop: ## Stop Redis
	-$(CONTAINER) stop duckapp-redis >/dev/null

test-redis: ## Cache tests against Redis in a container
	@started=; if ! $(CONTAINER) exec duckapp-redis redis-cli ping >/dev/null 2>&1; then $(MAKE) -s redis && started=1; sleep 1; fi; \
	cd gateway && DUCKAPP_TEST_REDIS=redis://127.0.0.1:26379/15 go test -count=1 ./internal/cache/; rc=$$?; \
	cd .. && if [ -n "$$started" ]; then $(MAKE) -s redis-stop; fi; exit $$rc
# duck:end

# duck:if s3
MINIO_ENV := DUCKAPP_S3_ENDPOINT=http://127.0.0.1:29000 DUCKAPP_S3_BUCKET=duckapp DUCKAPP_S3_PATH_STYLE=1 DUCKAPP_S3_ACCESS_KEY=duckapp DUCKAPP_S3_SECRET_KEY=duckapp-secret
minio: ## Start MinIO with a bucket for development (prints the DUCKAPP_S3_* settings)
	$(CONTAINER) run -d --rm --name duckapp-minio -p 29000:9000 -e MINIO_ROOT_USER=duckapp -e MINIO_ROOT_PASSWORD=duckapp-secret --entrypoint sh minio/minio -c 'mkdir -p /data/duckapp && minio server /data' >/dev/null
	@until curl -fs http://127.0.0.1:29000/minio/health/ready >/dev/null; do sleep 0.5; done; echo "$(MINIO_ENV)"

minio-stop: ## Stop MinIO
	-$(CONTAINER) stop duckapp-minio >/dev/null

test-s3: ## Object store tests against MinIO in a container
	@started=; if ! curl -fs http://127.0.0.1:29000/minio/health/ready >/dev/null 2>&1; then $(MAKE) -s minio >/dev/null && started=1; fi; \
	cd gateway && env $(MINIO_ENV) DUCKAPP_TEST_S3=1 go test -count=1 ./internal/objstore/; rc=$$?; \
	cd .. && if [ -n "$$started" ]; then $(MAKE) -s minio-stop; fi; exit $$rc
# duck:end

# duck:if site
# ---- site ----

site: ## Build the docs site into site/dist
	cd site && bun install && bun run build

site-dev: ## Docs site with hot reload
	cd site && bun run dev
# duck:end

# ---- release ----

PLATFORMS := linux/amd64 linux/arm64 darwin/arm64 windows/amd64

dist: web ## Static binaries for every platform, with checksums, in dist/
	@mkdir -p $(DIST)
	@for p in $(PLATFORMS); do \
		os=$${p%/*}; arch=$${p#*/}; ext=; [ $$os = windows ] && ext=.exe; \
		echo "→ $$os/$$arch"; \
		(cd gateway && CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o "../$(DIST)/duckapp-$$os-$$arch$$ext" ./cmd/duckapp) || exit 1; \
	done
	cd $(DIST) && sha256sum duckapp-* > SHA256SUMS

clean: ## Remove build outputs (keeps .dev data)
	rm -rf $(DIST) gateway/bin/duckapp
	find gateway/internal/server/ui/dist -mindepth 1 ! -name .gitkeep -delete
