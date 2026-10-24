# Duck Stack reference

Read only when the command table in SKILL.md is not enough. `npx ducktpl --help` and `npx create-duck --help` list every option.

## Field types

| Type | SQLite | PostgreSQL | Go | TypeScript |
|---|---|---|---|---|
| `string`, `text`, `uuid` | `TEXT NOT NULL DEFAULT ''` | `TEXT NOT NULL DEFAULT ''` | `string` | `string` |
| `int` | `INTEGER NOT NULL DEFAULT 0` | `BIGINT NOT NULL DEFAULT 0` | `int64` | `number` |
| `float` | `REAL NOT NULL DEFAULT 0` | `DOUBLE PRECISION NOT NULL DEFAULT 0` | `float64` | `number` |
| `bool` | `BOOLEAN NOT NULL DEFAULT 0` | `BOOLEAN NOT NULL DEFAULT false` | `bool` | `boolean` |
| `time` | `DATETIME` | `TIMESTAMPTZ` | `time.Time` | `string` |
| `date` | `TEXT` | `DATE` | `string` | `string` |
| `json` | `TEXT NOT NULL DEFAULT '{}'` | `JSONB NOT NULL DEFAULT '{}'` | `string` | `Record<string, unknown>` |
| `bytes` | `BLOB` | `BYTEA` | `[]byte` | `string` |
| `ref:<table>` | `TEXT REFERENCES …` | `TEXT REFERENCES …` | `string` | `string` |

A `ref` column gets an `_id` suffix (`task:ref:tasks` → `task_id`), a foreign key, an index and a seed helper in tests.

## Modifiers

- `!` required.
- `:unique`, `:index` — constraint / index on both engines.
- `:default(v)` — column default.
- `:enum(a,b,c)` — validated in Go, documented in OpenAPI, a `<select>` and a status badge in the UI.
- `:min(n)`, `:max(n)` — string length or number range, validated in Go.

## UI layouts (`ui:` in a schema, `--ui` on `add`)

- `table` — paginated admin table (default).
- `cards` — card grid with avatar/photo, enum pills, metadata.
- `feed` — timeline with author, timestamp and post cards.
- `chat` — message thread with bubbles and Enter-to-send.

## EventBus (modules `eventbus`, `ws`, `sse`)

In-process, non-blocking pub/sub in `gateway/internal/events/events.go`; across gateways with `redis`.

```go
unsub := srv.Events.On("order.", func(ev events.Event) {
    slog.Info("order event", "type", ev.Type, "id", ev.ID)
})
defer unsub()

srv.Events.PublishEvent(ctx, events.Event{Type: "order.placed", ID: order.ID, Data: order})
```

`ducktpl on <event> <name> --preset …` writes the handler in `gateway/internal/server/observers.go`, wires it at `// ducktpl:observers`, and adds tests. Presets: log, email, cache, webhook, pipe (`--pipe <resource>:<action>`), match_reciprocal.

## Rollback

After writing files, ducktpl runs sqlc, gofmt, openapi-gen, the UI type generation, `go vet` and the UI typecheck. If one fails it restores the touched files, deletes the new ones, regenerates derived code and prints `{"status":"error","step":…,"detail":…}`. `--no-rollback` keeps the broken state for debugging; `--no-generate` skips the whole step.

## Broken anchors

`ducktpl check --json` names the file and the missing `// ducktpl:<place>` comment. Put it back at that spot and run the command again.
