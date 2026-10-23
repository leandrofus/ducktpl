# create-duck

Genera una app como se arma la familia duck (ducktainer, duckJump, DuckOps,
duckforum): un gateway en Go que sirve una API JSON y la UI web embebida en
**un solo binario**, sobre SQLite o PostgreSQL, con el contrato OpenAPI
generado desde el código y los tipos de la UI generados desde el contrato.

```sh
bunx create-duck mi-app                 # pregunta
npx create-duck mi-app --web preact --with auth,rbac,audit,sse --yes
```

Después `cd mi-app && make dev`.

## Agregar recursos después

Dentro de un proyecto generado:

```sh
npx ducktpl add tasks title:string! notes:text done:bool priority:int
npx ducktpl --addRoute people full_name:string! --singular person
```

Pasa por todas las capas (migraciones de ambos motores, queries, handlers con
OpenAPI, rutas, permisos y grants, test HTTP, página con lista y formulario,
nav, refresco en vivo) y corre `make generate`. Detecta los módulos del
proyecto e inserta en las anclas `ducktpl:<lugar>`. `--dry-run` muestra antes
qué cambia.

## Siempre

- Gateway con rutas y su regla de acceso en un solo lugar, helpers JSON, CSRF
  por header + cookies SameSite, IP real detrás de proxies, CSP estricta.
- SQLite o PostgreSQL por URL, migraciones goose por motor, consultas sqlc que
  corren igual en los dos, tests que corren en cualquiera.
- Contrato: comentarios `openapi:operation` / `openapi:schema` junto a cada
  handler → `openapi.yaml` → `api-types.ts`. CI falla si alguno quedó viejo.
- UI con el design system de ducktainer (tokens, claro/oscuro, sidebar,
  paleta Ctrl-K, DataTable, drawers, modales, menús contextuales, toasts), i18n
  inglés + español.
- Un recurso de ejemplo (notas) por todas las capas, y un CLAUDE.md con las
  convenciones y el circuito para agregar un endpoint.

## Módulos (todos opcionales)

`auth`, `rbac` (roles editables + grants por objeto), `pam` (usuarios del
sistema, estilo ducktainer), `audit` (cadena HMAC), `ws`, `sse`, `redis`
(cache + eventos entre gateways), `s3` (adjuntos), `ssr` (estilo duckforum),
`ci`, `site`. Detalle en el [README en inglés](README.md#modules-all-opt-in).

## Cómo funciona

`template/` es un proyecto que anda con **todos los módulos activados**. El
código opcional está entre marcadores `duck:if` / `duck:else` / `duck:end` en
cualquier sintaxis de comentario; lo que está apagado por defecto va
comentado y el CLI lo descomenta si se elige. `node bin/create-duck.mjs
--check` valida los marcadores y `WEB=1 scripts/matrix.sh` genera 8
combinaciones y las compila y testea.
