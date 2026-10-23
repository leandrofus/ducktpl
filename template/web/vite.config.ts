import { defineConfig } from 'vite'
// duck:if react
import react from '@vitejs/plugin-react'
// duck:else
// import preact from '@preact/preset-vite'
// duck:end

// `bun run dev` (make dev) proxies the API to the gateway on :8080, so the
// session cookie and the CSRF header work as in production. `bun run build`
// writes into the gateway, which embeds the result.
export default defineConfig({
  // duck:if react
  plugins: [react()],
  // duck:else
  // plugins: [preact()], // aliases react and react-dom to preact/compat
  // duck:end
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', ws: true },
    },
  },
  build: { outDir: '../gateway/internal/server/ui/dist', emptyOutDir: true },
})
