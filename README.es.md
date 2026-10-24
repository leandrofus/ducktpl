# create-duck

Genera una app como se arma la familia duck (ducktainer, duckJump, DuckOps,
duckforum): un gateway en Go que sirve una API JSON y la UI web embebida en
**un solo binario**, sobre SQLite o PostgreSQL, con el contrato OpenAPI
generado desde el código y los tipos de la UI generados desde el contrato.

```sh
bunx create-duck mi-app                 # pregunta (web, modelo RLS multitenant/singleTenant, módulos, owner)
npx create-duck mi-app --web preact --rls multitenant --with auth,rbac,audit,sse --yes
```

Después `cd mi-app && make dev`.

## Con un agente de IA (Claude Code)

```sh
npx create-duck --install-skill         # una vez: copia el skill duck-stack a ~/.claude/skills
```

Después abre una sesión y escribe `/duck-stack crea una app de citas`. El skill
es manual a propósito (no se carga solo, así que no cuesta nada en otros
proyectos); agrega una línea en tu `~/.claude/CLAUDE.md` para acordarte. Hace
que el agente escriba un manifest `duck.yaml` y ejecute `create-duck --manifest`,
y que después la amplíe con `ducktpl … --json` en lugar de escribir cada capa a
mano: el CRUD, las migraciones, el contrato y las páginas salen del generador, y
el agente gasta sus tokens en lo propio de tu app. Vuelve a ejecutarlo para
actualizar el skill.

## Modificar base de datos y agregar recursos

Dentro de un proyecto generado:

```sh
# Agregar un recurso CRUD
npx ducktpl add tasks title:string! notes:text done:bool priority:int
npx ducktpl --addRoute people full_name:string! --singular person

# Modificar esquema de base de datos en SQLite y PostgreSQL
npx ducktpl moddb addColumn tasks status:string!
npx ducktpl moddb renameColumn tasks title heading
npx ducktpl moddb changeType tasks priority:int! --force
npx ducktpl moddb removeColumn tasks status

# Moldear DTOs: evitar fugas de datos y reducir carga innecesaria
npx ducktpl dto tasks                       # inspeccionar DTO actual vs columnas de tabla
npx ducktpl dto tasks title done priority   # exponer solo campos específicos
npx ducktpl dto tasks --omit internal_notes # ocultar campos internos o sensibles

# Introspección y salida para Agentes de IA
npx ducktpl info --json                     # detectar módulos activos, tablas y tipos
npx ducktpl add tasks title:string! --json  # JSON estructurado con rollback automático si falla build
```

Pasa por todas las capas (migraciones de ambos motores, queries, handlers con
OpenAPI, rutas, permisos y grants, test HTTP, página con lista y formulario,
nav, refresco en vivo) y corre `make generate`. Detecta los módulos del
proyecto e inserta en las anclas `ducktpl:<lugar>`. `--dry-run` muestra antes
qué cambia.

`ducktpl add` entrega el lado de datos y un panel de administración (tabla, tarjetas, feed, chat, calendario). Para una app que la gente usa (turnos, CRM, CMS) mira [Domain views](docs/domain-views.md): cómo encajan recursos y vistas, qué existe y qué viene (en inglés).

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
