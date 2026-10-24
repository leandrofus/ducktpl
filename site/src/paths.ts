import type { Lang } from './i18n'

export const REPO_URL = 'https://github.com/leandrofus/ducktpl'

const base = import.meta.env.BASE_URL.replace(/\/$/, '')

/** The site's home page in a language. */
export function homePath(lang: Lang): string {
  return lang === 'en' ? `${base}/` : `${base}/${lang}/`
}

/** Documentation anchor or page path. */
export function docsPath(lang: Lang, anchor = ''): string {
  const prefix = homePath(lang)
  return anchor ? `${prefix}#${anchor}` : `${prefix}#commands`
}

/** A file served from the public directory. */
export function assetPath(name: string): string {
  return `${base}/${name}`
}
