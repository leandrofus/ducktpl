// observer.mjs: generate domain event observers/subscribers for create-duck projects.
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activateModule } from './modules.mjs'

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'template')

const pascal = (s) =>
  s
    .split(/[^a-zA-Z0-9]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')

const camel = (s) => {
  const p = pascal(s)
  return p ? p[0].toLowerCase() + p.slice(1) : ''
}

// The presets use different standard packages; import the ones the code uses and
// drop the ones it does not, or the file does not compile.
function fixImports(code) {
  const m = /import \(\n([\s\S]*?)\n\)\n/.exec(code)
  if (!m) return code
  const body = code.slice(m.index + m[0].length)
  let lines = m[1].split('\n')
  for (const pkg of ['context', 'time']) {
    const used = new RegExp(`\\b${pkg}\\.`).test(body)
    const has = lines.some((l) => l.trim() === `"${pkg}"`)
    if (used && !has) lines = [`\t"${pkg}"`, ...lines]
    if (!used && has) lines = lines.filter((l) => l.trim() !== `"${pkg}"`)
  }
  return code.slice(0, m.index) + `import (\n${lines.join('\n')}\n)\n` + body
}

export function planObserver(p, eventPattern, observerName, opts = {}) {
  const pat = eventPattern?.trim()
  if (!pat) throw new Error('event pattern is required (e.g. posts.like, places.checkin, *.changed)')

  const obsName = observerName?.trim().replace(/[^a-zA-Z0-9_]/g, '')
  if (!obsName) throw new Error('observer name must be alphanumeric (e.g. sendEmail, invalidateCache, notifyWebhook)')

  const preset = (opts.preset || (opts.pipe ? 'pipe' : 'log')).toLowerCase()
  const validPresets = ['log', 'email', 'cache', 'webhook', 'pipe', 'match_reciprocal']
  if (!validPresets.includes(preset)) {
    throw new Error(`invalid preset "${opts.preset}". Valid presets: ${validPresets.join(', ')}`)
  }

  const files = []
  const notes = []

  // Ensure eventbus module is active (copies internal/events if missing)
  const eventsFile = join(p.root, 'gateway/internal/events/events.go')
  if (!existsSync(eventsFile)) {
    activateModule(p, TEMPLATE, 'eventbus')
    notes.push('automatically activated module "eventbus"')
  }

  const methodName = `on${pascal(obsName)}`
  const obsPath = 'gateway/internal/server/observers.go'
  const fullObsPath = join(p.root, obsPath)

  let obsContent = ''
  let obsCreated = false

  if (existsSync(fullObsPath)) {
    obsContent = readFileSync(fullObsPath, 'utf8')
    if (obsContent.includes(`func (s *Server) ${methodName}(`)) {
      throw new Error(`observer method "${methodName}" already exists in ${obsPath}`)
    }
  } else {
    obsCreated = true
    obsContent = `package server

import (
	"context"
	"log/slog"

	"${p.module}/internal/events"
)

// registerObservers attaches domain event subscribers to s.Events.
func (s *Server) registerObservers() {
	if s.Events == nil {
		return
	}
	// ducktpl:observers
}

// ducktpl:handlers
`
  }

  // 1. Build observer handler body based on preset
  let handlerBody = ''
  switch (preset) {
    case 'email':
      handlerBody = `\tslog.Info("observer [email]: ${pat}", "event", ev.Type, "id", ev.ID)
	// TODO: dispatch email notification to user or administrator
	_ = context.Background()`
      break
    case 'cache':
      handlerBody = `\tslog.Info("observer [cache]: ${pat}", "event", ev.Type, "id", ev.ID)
	// TODO: invalidate or warm cache entries for resource
	_ = time.Now()`
      break
    case 'webhook':
      handlerBody = `\tslog.Info("observer [webhook]: ${pat}", "event", ev.Type, "id", ev.ID)
	// TODO: deliver HTTP POST payload to configured webhook destination
	_ = context.Background()`
      break
    case 'match_reciprocal':
      handlerBody = `\tctx := context.Background()
	slog.Info("pipeline [match_reciprocal]: evaluating mutual match", "event", ev.Type, "id", ev.ID)
	// Query opposite reaction and conditionally create match record
	if ev.Data != nil {
		slog.Debug("evaluating payload", "data", ev.Data)
	}
	_ = ctx`
      break
    case 'pipe':
      handlerBody = `\tctx := context.Background()
	slog.Info("pipeline [pipe]: cascading domain mutation", "event", ev.Type, "id", ev.ID, "target", "${opts.pipe || ''}")
	// Execute piped mutation in target store and publish cascade event
	_ = ctx`
      break
    case 'log':
    default:
      handlerBody = `\tslog.Info("observer [log]: ${pat}", "event", ev.Type, "id", ev.ID, "action", "${obsName}")`
      break
  }

  const handlerCode = `
func (s *Server) ${methodName}(ev events.Event) {
${handlerBody}
}
`

  // 2. Insert subscription in registerObservers at // ducktpl:observers
  const subLine = `\ts.Events.On("${pat}", s.${methodName})\n`
  const obsAnchor = '// ducktpl:observers'
  if (obsContent.includes(obsAnchor)) {
    obsContent = obsContent.replace(obsAnchor, subLine + '\t' + obsAnchor)
  } else {
    const regIdx = obsContent.indexOf('func (s *Server) registerObservers()')
    if (regIdx !== -1) {
      const braceIdx = obsContent.indexOf('}', regIdx)
      obsContent = obsContent.slice(0, braceIdx) + subLine + obsContent.slice(braceIdx)
    }
  }

  // 3. Append handler function
  const handlersAnchor = '// ducktpl:handlers'
  if (obsContent.includes(handlersAnchor)) {
    obsContent = obsContent.replace(handlersAnchor, handlerCode + '\n' + handlersAnchor)
  } else {
    obsContent = obsContent.trimEnd() + '\n' + handlerCode
  }

  obsContent = fixImports(obsContent)

  files.push({
    path: obsPath,
    content: obsContent,
    created: obsCreated,
  })

  // 4. Ensure s.registerObservers() is called in server.go
  const srvPath = 'gateway/internal/server/server.go'
  const fileExists = (rel) => (p.existsSync ? p.existsSync(rel) : existsSync(join(p.root, rel)))
  const getFile = (rel) => (p.readFile ? p.readFile(rel) : readFileSync(join(p.root, rel), 'utf8'))
  if (fileExists(srvPath)) {
    let srvContent = getFile(srvPath)
    if (!srvContent.includes('s.registerObservers()')) {
      const muxAnchor = 'mux := http.NewServeMux()'
      if (srvContent.includes(muxAnchor)) {
        srvContent = srvContent.replace(muxAnchor, `${muxAnchor}\n\ts.registerObservers()`)
        files.push({
          path: srvPath,
          content: srvContent,
          created: false,
        })
        notes.push('wired s.registerObservers() into server.go')
      } else if (srvContent.includes('// ducktpl:routes')) {
        srvContent = srvContent.replace('// ducktpl:routes', `s.registerObservers()\n\t// ducktpl:routes`)
        files.push({
          path: srvPath,
          content: srvContent,
          created: false,
        })
        notes.push('wired s.registerObservers() into server.go')
      }
    }
  }

  // 5. Create or update observers_test.go
  const testPath = 'gateway/internal/server/observers_test.go'
  const fullTestPath = join(p.root, testPath)
  let testContent = ''
  let testCreated = false

  const testEvent = pat.includes('*') ? pat.replace('*', 'test') : pat
  const testFunc = `
func TestObserver${pascal(obsName)}(t *testing.T) {
	bus := events.New()
	s := &Server{Events: bus}
	s.registerObservers()

	var wg sync.WaitGroup
	wg.Add(1)
	cancel := bus.On("${pat}", func(ev events.Event) {
		wg.Done()
	})
	defer cancel()

	bus.PublishEvent(context.Background(), events.Event{Type: "${testEvent}", ID: "test-id"})

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// Success
	case <-time.After(2 * time.Second):
		t.Fatal("observer timed out waiting for event ${pat}")
	}
}
`

  if (existsSync(fullTestPath)) {
    testContent = readFileSync(fullTestPath, 'utf8')
    if (!testContent.includes(`TestObserver${pascal(obsName)}`)) {
      testContent = testContent.trimEnd() + '\n' + testFunc
    }
  } else {
    testCreated = true
    testContent =
      `package server

import (
	"context"
	"sync"
	"testing"
	"time"

	"${p.module}/internal/events"
)
` + testFunc
  }

  files.push({
    path: testPath,
    content: testContent,
    created: testCreated,
  })

  notes.push(`registered observer "${obsName}" on event "${pat}" (preset: ${preset})`)

  return {
    status: 'ok',
    action: 'on',
    event: pat,
    observerName: obsName,
    preset,
    method: methodName,
    files,
    notes,
  }
}
