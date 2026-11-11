export interface ApiErrorDetails {
  fieldErrors?: Record<string, string[]>
  formErrors?: string[]
  [key: string]: unknown
}

export class ApiError extends Error {
  status: number
  code?: string
  details?: ApiErrorDetails

  constructor(message: string, status: number, code?: string, details?: ApiErrorDetails) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('content-type') && !(options.body instanceof FormData)) {
    headers.set('content-type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'include',
      ...options,
      headers,
    })
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok) {
    let message = `Request failed (${response.status}).`
    let code: string | undefined
    let details: ApiErrorDetails | undefined
    if (contentType.includes('application/json')) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string; code?: string; details?: ApiErrorDetails }
        | null
      if (data?.error) message = data.error
      code = data?.code
      details = data?.details
    }
    throw new ApiError(message, response.status, code, details)
  }

  if (response.status === 204) return undefined as T
  if (contentType.includes('application/json')) return (await response.json()) as T
  return (await response.text()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, file: File) => {
    const form = new FormData()
    form.append('image', file)
    return request<T>(path, { method: 'POST', body: form })
  },
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}

export function fieldError(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined
  return error.details?.fieldErrors?.[field]?.[0]
}

export async function downloadCsv(path: string, filename: string) {
  const response = await fetch(`/api${path}`, { credentials: 'include' })
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(data?.error ?? 'The export could not be generated.', response.status)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}
