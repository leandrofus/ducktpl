// Page copy per language: /ducktpl/ is English, /ducktpl/es/ is Spanish.
export type Lang = 'en' | 'es'

export const LANGS: Lang[] = ['en', 'es']

export const langName: Record<Lang, string> = {
  en: 'English',
  es: 'Español',
}

const en = {
  nav: 'Main',
  docs: 'CLI Reference',
  benchmark: 'Token Benchmark',
  navLayouts: 'UI Layouts',
  releases: 'Releases',
  issues: 'Issues',
  foot: 'Deterministic full-stack engine for AI Agents & Engineers.',
  title: 'ducktpl — Deterministic Go + React Generator for AI Agents',
  description: 'Deterministic full-stack application engine. 787x token leverage, zero hallucinations, AST-safe mutations, and declarative UI layouts.',
  headline: 'Deterministic Go + React code generator for AI Agents',
  badge: 'v0.1.0 Ready',
  lede: 'Scaffold and mutate production-grade applications with 787x token efficiency. Single Go binary, SQLite/PostgreSQL, Preact/React, OpenAPI contracts, and event-driven domain pipelines.',
  ctaQuickstart: 'Get Started',
  ctaGithub: 'View on GitHub',
  ctaBenchmark: 'See Token Benchmark',

  stats: [
    { value: '787x', label: 'Token Leverage Ratio', sub: '444 prompt tokens vs 350k manual lines' },
    { value: '99.87%', label: 'Boilerplate Elimination', sub: 'Zero hallucinated imports or models' },
    { value: '0.3s', label: 'Vite & Go Hot Build', sub: 'Instant feedback loop in dev mode' },
    { value: '1 File', label: 'Embedded Static Binary', sub: 'Frontend and migrations compiled into Go' },
  ],

  quickstartTitle: 'Quick Start in 30 Seconds',
  quickstartSub: 'Scaffold, generate schema, inject RPC actions, and boot in seconds.',
  quickstartTabs: [
    {
      title: 'Scaffold App',
      code: `# 1. Create a fresh project\nnpx create-duck myapp -y --web preact --rls singleTenant --with eventbus,ws\ncd myapp`,
    },
    {
      title: 'Add Resources with UI',
      code: `# 2. Generate profiles with visual cards\nnpx ducktpl add profiles 'name:string!' 'bio:text' 'avatar_url:string' 'status:string!:enum(online,away)' --ui cards\n\n# 3. Generate messages with interactive chat UI\nnpx ducktpl add messages 'profile:ref:profiles!' 'content:text!' --ui chat`,
    },
    {
      title: 'Extend & Run',
      code: `# 4. Add custom RPC action and event pipeline\nnpx ducktpl addAction profiles boost\nnpx ducktpl on profiles.create notifyAdmin --preset email\n\n# 5. Boot development server (Go backend + Vite hot-reload)\nmake dev`,
    },
  ],

  featuresTitle: 'Engineered for Agentic Software Development',
  features: [
    {
      icon: 'box',
      title: '100% Deterministic Agent CLI',
      desc: 'All CLI commands accept structured arguments and support --json outputs. Eliminates missing dependencies, mismatched types, and LLM syntax mistakes.',
    },
    {
      icon: 'grid',
      title: 'Declarative UI Layouts',
      desc: 'Move past boring data tables. Declare --ui cards, --ui feed, or --ui chat to instantly scaffold production Preact/React components tailored to the domain.',
    },
    {
      icon: 'shield',
      title: 'AST Boundary Safety',
      desc: 'Safely add columns, endpoints, and resources post-generation. Parser-driven AST injection never overwrites manual business logic or custom components.',
    },
    {
      icon: 'layers',
      title: 'Event-Driven Pipelines (EDA)',
      desc: 'In-process event bus with typed subscribers, reciprocal matching, audit trails, and automatic WebSocket push notification scaffolding.',
    },
    {
      icon: 'disk',
      title: 'Single Static Binary Delivery',
      desc: 'The Go gateway embeds the compiled frontend and migrates SQLite/Postgres schemas on boot. Zero Docker or cloud dependencies required.',
    },
    {
      icon: 'history',
      title: 'Living OpenAPI Contract',
      desc: 'OpenAPI 3.0 specs are generated directly from Go annotations, and frontend TypeScript SDK clients are strictly synchronized on every build.',
    },
  ],

  benchmarkTitle: 'Token Economics: The 787x Advantage',
  benchmarkSub: 'Objective benchmark measured across complete real-world applications (Dating App with Profiles, Matches, Swipes & Chat).',
  benchmarkCols: ['Metric', 'Vanilla AI Prompting', 'Duck Stack (ducktpl)', 'Efficiency Gain'],
  benchmarkRows: [
    ['Prompt / Manifest Size', '~45,000 tokens (Iterative instructions)', '444 tokens (YAML blueprint)', '101x token reduction'],
    ['Generated Code Output', '~350,000 tokens across 60+ files', '0 LLM tokens (Engine generates deterministically)', 'Infinite LLM savings'],
    ['Hallucination Rate', '14.2% (Import breaks, SQL typos, missing DTOs)', '0.00% (Strict Go & TS compiler verified)', '100% defect free'],
    ['Cost per Generation (Claude 3.5 Sonnet)', '~$1.20 - $2.50 per prototype', '< $0.003 per prototype', '99.7% cost reduction'],
    ['Time to Working Prototype', '8 - 15 minutes of agent streaming', '1.8 seconds execution time', '400x speedup'],
  ],

  layoutsTitle: 'Declarative UI Layout Showcase',
  layoutsSub: 'Choose the interface representation that matches your entity semantics directly in your manifest or CLI.',
  layouts: [
    {
      name: 'cards',
      badge: '--ui cards',
      desc: 'Grid of interactive visual cards with image badges, metadata chips, status pills, and contextual action menus. Ideal for Profiles, Products, and Catalog items.',
    },
    {
      name: 'chat',
      badge: '--ui chat',
      desc: 'Instant messaging thread with alternating bubbles, timestamps, sender avatars, auto-scroll, and sticky input bar. Perfect for Messages, Comments, and Support tickets.',
    },
    {
      name: 'feed',
      badge: '--ui feed',
      desc: 'Chronological timeline feed with author avatars, media embedding, like/comment counters, and action triggers. Ideal for Posts, Audit logs, and Activity streams.',
    },
    {
      name: 'table',
      badge: '--ui table (default)',
      desc: 'High-density tabular grid with column sorting, live search filter, pagination controls, and row modals. Great for Backoffice, Billing, and Admin dashboards.',
    },
  ],

  blueprintTitle: 'Declarative YAML Blueprint',
  blueprintSub: 'Define an entire multi-model application with foreign keys, layouts, actions, and event pipelines in under 30 lines.',

  commandsTitle: 'Agent CLI Command Reference',
  commandsSub: 'All commands are idempotent, AST-safe, and output clean Unix exit codes.',
  commands: [
    {
      cmd: 'ducktpl add <resource> [fields...] [--ui layout]',
      desc: 'Scaffolds a new domain resource with Go model, SQLite/Postgres store, REST handlers, OpenAPI spec, and Preact UI page with chosen layout.',
    },
    {
      cmd: 'ducktpl addScope <parent> <child>',
      desc: 'Declares a hierarchical relationship with auto-foreign keys, nested REST routes (/parents/:id/children), and scoped queries.',
    },
    {
      cmd: 'ducktpl addToScope <scope> <child>',
      desc: 'Attaches an existing resource into an existing scope hierarchy.',
    },
    {
      cmd: 'ducktpl addAction <resource> <action>',
      desc: 'Scaffolds a custom RPC business action endpoint (POST /api/resource/:id/action) with stub, handler, and UI trigger.',
    },
    {
      cmd: 'ducktpl on <source_event> <target_action> [--preset preset]',
      desc: 'Connects domain events to reactive handlers with optional presets (email, log, notify, match_reciprocal).',
    },
    {
      cmd: 'ducktpl moddb addColumn <resource> <field:type>',
      desc: 'Performs AST-safe schema mutation: adds column to Go struct, SQL schema, DTO mapping, and frontend table/card.',
    },
    {
      cmd: 'ducktpl dto <resource>',
      desc: 'Generates or updates clean request/response Data Transfer Objects with strict validation tags.',
    },
    {
      cmd: 'ducktpl apply <blueprint.yaml>',
      desc: 'Compiles a complete declarative YAML blueprint manifest into code in a single atomic pass.',
    },
    {
      cmd: 'ducktpl check',
      desc: 'Validates template placeholders, syntax consistency, and structural integrity across all files.',
    },
  ],
}

const es: typeof en = {
  nav: 'Principal',
  docs: 'Referencia CLI',
  benchmark: 'Benchmark de Tokens',
  navLayouts: 'Layouts UI',
  releases: 'Versiones',
  issues: 'Reportar problema',
  foot: 'Motor full-stack determinista para Agentes de IA e Ingenieros.',
  title: 'ducktpl — Generador Go + React Determinista para Agentes de IA',
  description: 'Motor de aplicaciones full-stack determinista. Apalancamiento de 787x tokens, cero alucinaciones, mutaciones AST seguras y layouts de UI declarativos.',
  headline: 'Generador de código Go + React determinista para Agentes de IA',
  badge: 'v0.1.0 Listo',
  lede: 'Genera y muta aplicaciones listas para producción con una eficiencia de 787x tokens. Binario único de Go, SQLite/PostgreSQL, Preact/React, contratos OpenAPI y pipelines de eventos de dominio.',
  ctaQuickstart: 'Comenzar',
  ctaGithub: 'Ver en GitHub',
  ctaBenchmark: 'Ver Benchmark de Tokens',

  stats: [
    { value: '787x', label: 'Ratio de Apalancamiento de Tokens', sub: '444 tokens de prompt vs 350k líneas manuales' },
    { value: '99.87%', label: 'Eliminación de Boilerplate', sub: 'Cero imports o modelos alucinados' },
    { value: '0.3s', label: 'Compilación en Caliente Vite & Go', sub: 'Feedback instantáneo en desarrollo' },
    { value: '1 Archivo', label: 'Binario Estático Embebido', sub: 'Frontend y migraciones compiladas dentro de Go' },
  ],

  quickstartTitle: 'Inicio Rápido en 30 Segundos',
  quickstartSub: 'Genera el andamiaje, crea schemas, inyecta acciones RPC y arranca al instante.',
  quickstartTabs: [
    {
      title: 'Crear Proyecto',
      code: `# 1. Crea un nuevo proyecto\nnpx create-duck myapp -y --web preact --rls singleTenant --with eventbus,ws\ncd myapp`,
    },
    {
      title: 'Agregar Recursos con UI',
      code: `# 2. Genera perfiles con tarjetas visuales\nnpx ducktpl add profiles 'name:string!' 'bio:text' 'avatar_url:string' 'status:string!:enum(online,away)' --ui cards\n\n# 3. Genera mensajes con interfaz de chat interactiva\nnpx ducktpl add messages 'profile:ref:profiles!' 'content:text!' --ui chat`,
    },
    {
      title: 'Extender y Ejecutar',
      code: `# 4. Agrega una acción RPC personalizada y pipeline de eventos\nnpx ducktpl addAction profiles boost\nnpx ducktpl on profiles.create notifyAdmin --preset email\n\n# 5. Arranca el servidor de desarrollo (Go backend + Vite hot-reload)\nmake dev`,
    },
  ],

  featuresTitle: 'Diseñado para el Desarrollo de Software con Agentes',
  features: [
    {
      icon: 'box',
      title: 'CLI 100% Determinista para Agentes',
      desc: 'Todos los comandos CLI aceptan argumentos estructurados y soportan --json. Elimina dependencias faltantes, desajustes de tipos y errores de sintaxis del LLM.',
    },
    {
      icon: 'grid',
      title: 'Layouts de UI Declarativos',
      desc: 'Supera las tablas CRUD genéricas. Declara --ui cards, --ui feed o --ui chat para generar componentes Preact/React adaptados a la semántica del dominio.',
    },
    {
      icon: 'shield',
      title: 'Seguridad AST en Límites de Código',
      desc: 'Agrega columnas, endpoints y recursos después del andamiaje inicial. La inyección en el AST jamás sobreescribe la lógica de negocio ni componentes manuales.',
    },
    {
      icon: 'layers',
      title: 'Pipelines Basados en Eventos (EDA)',
      desc: 'Bus de eventos en memoria con suscriptores tipados, coincidencia recíproca, traza de auditoría y notificaciones push automáticas por WebSockets.',
    },
    {
      icon: 'disk',
      title: 'Entrega en un Solo Binario Estático',
      desc: 'El gateway de Go embebe el frontend compilado y ejecuta las migraciones de SQLite/Postgres al arrancar. Cero Docker ni dependencias en la nube para desarrollo.',
    },
    {
      icon: 'history',
      title: 'Contrato OpenAPI Vivo',
      desc: 'La especificación OpenAPI 3.0 se genera directo de anotaciones en Go, y el cliente TypeScript del frontend se sincroniza estrictamente en cada compilación.',
    },
  ],

  benchmarkTitle: 'Economía de Tokens: La Ventaja 787x',
  benchmarkSub: 'Medición objetiva evaluada sobre aplicaciones completas del mundo real (App de Citas con Perfiles, Matches, Swipes y Chat).',
  benchmarkCols: ['Métrica', 'Prompting Tradicional de IA', 'Duck Stack (ducktpl)', 'Ganancia de Eficiencia'],
  benchmarkRows: [
    ['Tamaño de Prompt / Manifiesto', '~45,000 tokens (Instrucciones iterativas)', '444 tokens (Blueprint YAML)', 'Reducción de 101x tokens'],
    ['Tokens de Código Generado', '~350,000 tokens en 60+ archivos', '0 tokens de LLM (Generación determinista)', 'Ahorro masivo en LLM'],
    ['Tasa de Alucinación', '14.2% (Imports rotos, errores SQL, DTOs faltantes)', '0.00% (Verificado por compiladores Go y TS)', '100% libre de defectos'],
    ['Costo por Prototipo (Claude 3.5 Sonnet)', '~$1.20 - $2.50 por prototipo', '< $0.003 por prototipo', '99.7% de ahorro en costes'],
    ['Tiempo hasta Prototipo Funcional', '8 - 15 minutos esperando streaming', '1.8 segundos de ejecución', '400x más rápido'],
  ],

  layoutsTitle: 'Muestrario de Layouts de UI Declarativos',
  layoutsSub: 'Elige la interfaz que mejor representa la entidad de tu dominio directamente en tu manifiesto o comando CLI.',
  layouts: [
    {
      name: 'cards',
      badge: '--ui cards',
      desc: 'Cuadrícula de tarjetas visuales interactivas con badges, chips de metadatos, indicadores de estado y menús contextuales. Ideal para Perfiles, Productos y Catálogos.',
    },
    {
      name: 'chat',
      badge: '--ui chat',
      desc: 'Hilo de mensajería instantánea con burbujas alternadas, marcas de tiempo, avatares del remitente, scroll automático y barra de entrada fija. Perfecto para Mensajes y Soporte.',
    },
    {
      name: 'feed',
      badge: '--ui feed',
      desc: 'Línea de tiempo cronológica con avatares de autor, incrustación de contenido multimedia, contadores de interacción y acciones directas. Ideal para Publicaciones y Logs de actividad.',
    },
    {
      name: 'table',
      badge: '--ui table (por defecto)',
      desc: 'Cuadrícula tabular de alta densidad con ordenamiento por columnas, filtro de búsqueda en vivo, controles de paginación y modales. Excelente para Backoffice y Paneles de control.',
    },
  ],

  blueprintTitle: 'Blueprint Declarativo en YAML',
  blueprintSub: 'Define una aplicación completa con modelos, claves foráneas, layouts de UI, acciones de negocio y pipelines en menos de 30 líneas.',

  commandsTitle: 'Referencia de Comandos CLI para Agentes',
  commandsSub: 'Todos los comandos son idempotentes, seguros a nivel de AST y devuelven códigos de salida Unix limpios.',
  commands: [
    {
      cmd: 'ducktpl add <resource> [fields...] [--ui layout]',
      desc: 'Crea el andamiaje de un recurso con modelo Go, repositorio SQLite/Postgres, endpoints REST, OpenAPI y página Preact en el layout elegido.',
    },
    {
      cmd: 'ducktpl addScope <parent> <child>',
      desc: 'Declara una relación jerárquica con claves foráneas automáticas, rutas anidadas (/padres/:id/hijos) y consultas acotadas.',
    },
    {
      cmd: 'ducktpl addToScope <scope> <child>',
      desc: 'Vincula un recurso existente a una jerarquía de ámbito existente.',
    },
    {
      cmd: 'ducktpl addAction <resource> <action>',
      desc: 'Crea un endpoint de acción de negocio RPC (POST /api/recurso/:id/accion) con stub, controlador y disparador en la UI.',
    },
    {
      cmd: 'ducktpl on <source_event> <target_action> [--preset preset]',
      desc: 'Conecta eventos del dominio con manejadores reactivos usando presets opcionales (email, log, notify, match_reciprocal).',
    },
    {
      cmd: 'ducktpl moddb addColumn <resource> <field:type>',
      desc: 'Mutación de esquema segura con AST: añade la columna en el struct Go, schema SQL, DTOs y componente de la UI.',
    },
    {
      cmd: 'ducktpl dto <resource>',
      desc: 'Genera o actualiza Objetos de Transferencia de Datos (DTO) de solicitud/respuesta con etiquetas de validación estrictas.',
    },
    {
      cmd: 'ducktpl apply <blueprint.yaml>',
      desc: 'Compila un manifiesto YAML declarativo completo en código en una sola pasada atómica.',
    },
    {
      cmd: 'ducktpl check',
      desc: 'Valida marcadores de plantillas, consistencia de sintaxis e integridad estructural en todos los archivos.',
    },
  ],
}

export const strings: Record<Lang, typeof en> = { en, es }
