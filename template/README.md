# DuckApp

One binary with the web UI inside: a Go gateway that serves the API and the
embedded UI, on SQLite out of the box or PostgreSQL. Scaffolded with
[create-duck](https://github.com/leandrofus/create-duck).

## Develop

Needs Go 1.26+ and [Bun](https://bun.sh).

```sh
make dev        # gateway on :8080, UI with hot reload on http://localhost:5173
make test       # vet, tests, generated code up to date, UI typecheck
make build      # dist/bin/duckapp, UI embedded
```

<!-- duck:if auth -->
`make dev` signs you in as `admin` / `admin-password`. In production the first
start creates `admin` with a random password printed once on stderr (or
`DUCKAPP_ADMIN_PASSWORD`).

<!-- duck:end -->
## Run

```sh
./duckapp serve --listen 0.0.0.0:8080           # SQLite file duckapp.db
DUCKAPP_DB=postgres://user:pw@host/db ./duckapp serve
./duckapp -h                                    # every flag; each has a DUCKAPP_* variable
```

Behind a reverse proxy, list it in `--trusted-proxies` so client addresses
and HTTPS are seen correctly. `deploy/systemd/` has a hardened unit.

<!-- duck:if pam -->
### System users (PAM)

Build with `make build-pam` (CGO and libpam headers), install
`deploy/systemd/duckapp.pam` as `/etc/pam.d/duckapp` and the `duckapp-pam`
socket units (a root helper the unprivileged gateway asks), then map groups to
roles: `DUCKAPP_PAM_ROLES=wheel:admin,staff:user`.

<!-- duck:end -->
<!-- duck:if s3 -->
### Files

Kept in `DUCKAPP_FILES` (a directory) unless an S3 bucket is configured:
`DUCKAPP_S3_ENDPOINT`, `DUCKAPP_S3_BUCKET`, `DUCKAPP_S3_ACCESS_KEY`,
`DUCKAPP_S3_SECRET_KEY` (and `DUCKAPP_S3_PATH_STYLE=1` for MinIO). `make minio`
starts one for development.

<!-- duck:end -->
<!-- duck:if redis -->
### Several gateways

Point them at the same PostgreSQL and the same Redis (`DUCKAPP_REDIS`): the
cache is shared and live events reach clients of every gateway.

<!-- duck:end -->
## The API

`gateway/openapi/openapi.yaml` is the contract, generated from comments next
to each handler (`make generate`), and the UI's TypeScript types are generated
from it. See [CLAUDE.md](CLAUDE.md) for how to add an endpoint.
