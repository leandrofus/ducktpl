import { defineConfig } from 'astro/config'

// Served by GitHub Pages at https://duckowner.github.io/duckapp/.
export default defineConfig({
  site: 'https://duckowner.github.io',
  base: '/duckapp',
  // the icon is shared with the web UI
  publicDir: '../web/public',
})
