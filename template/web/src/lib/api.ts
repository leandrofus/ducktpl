import { getLang } from '../i18n'
import type { components } from './api-types'

// Thin client for the gateway's /api/v1. Types come from the OpenAPI
// contract (make generate: Go comments → openapi.yaml → api-types.ts), so a
// changed DTO breaks the build here, not at runtime.

export type Schemas = components['schemas']
export interface Page<T> {
  items: T[]
  total: number
  page: number
  per_page: number
}

export type Note = Schemas['Note']
export type PaginatedNotes = Schemas['PaginatedNotes']
// ducktpl:types
// duck:if auth
export type User = Schemas['User']
export type PaginatedUsers = Schemas['PaginatedUsers']
export type Me = Schemas['Me']
// duck:end
// duck:if rbac
export type Role = Schemas['Role']
export type Grant = Schemas['Grant']
export type Permission = Schemas['Permission']
// duck:end
// duck:if audit
export type AuditEvent = Schemas['AuditEvent']
export type PaginatedAuditEvents = Schemas['PaginatedAuditEvents']
// duck:end
// duck:if s3
export type FileInfo = Schemas['File']
// duck:end

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

const noRedirect = ['/auth/login', '/auth/me']

// X-DuckApp-Request: required on every state-changing request (CSRF).
const CSRF = { 'X-DuckApp-Request': '1' }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api/v1' + path, {
    method,
    headers: { ...CSRF, 'Accept-Language': getLang(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  if (res.status === 401 && !noRedirect.includes(path)) onUnauthorized()
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) throw new ApiError(res.status, data?.error || 'error', data?.message || data?.error || res.statusText)
  return data as T
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, body?: unknown) => request<T>('POST', p, body),
  put: <T = any>(p: string, body?: unknown) => request<T>('PUT', p, body),
  patch: <T = any>(p: string, body: unknown) => request<T>('PATCH', p, body),
  del: <T = any>(p: string, body?: unknown) => request<T>('DELETE', p, body),
}

export const enc = encodeURIComponent

// duck:if s3
/** Uploads a file from this computer, raw body, as the API expects. */
export async function upload<T>(path: string, file: File): Promise<T> {
  const res = await fetch(`/api/v1${path}${path.includes('?') ? '&' : '?'}name=${enc(file.name)}`, {
    method: 'POST',
    headers: { ...CSRF, 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
    credentials: 'same-origin',
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error || 'error', data?.message || res.statusText)
  return data as T
}
// duck:end
