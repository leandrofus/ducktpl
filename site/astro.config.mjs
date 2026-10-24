import { copyFile } from 'node:fs/promises'
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

function sitemapAlias() {
  return {
    name: 'sitemap-alias',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        try {
          await copyFile(new URL('sitemap-index.xml', dir), new URL('sitemap.xml', dir))
        } catch {
          // ignore if single sitemap is generated
        }
      },
    },
  }
}

// Served by GitHub Pages at https://leandrofus.github.io/ducktpl/
export default defineConfig({
  site: 'https://leandrofus.github.io',
  base: '/ducktpl',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en-US', es: 'es-ES' },
      },
    }),
    sitemapAlias(),
  ],
})
