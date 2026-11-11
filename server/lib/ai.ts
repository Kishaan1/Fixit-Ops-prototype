import { config } from '../env'
import { HttpError } from './http'

export type AiSource = { title: string; url: string }

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

export async function geminiGenerate(input: {
  prompt: string
  imageBase64?: string
  mimeType?: string
  useSearch?: boolean
  timeoutMs?: number
}): Promise<{ text: string; sources: AiSource[]; provider: string; model: string }> {
  if (!config.geminiApiKey) {
    throw new HttpError(503, 'AI is not configured on this server. Add GEMINI_API_KEY to enable it.', {
      code: 'AI_NOT_CONFIGURED',
    })
  }

  const parts: GeminiPart[] = [{ text: input.prompt }]
  if (input.imageBase64) {
    parts.push({
      inlineData: {
        mimeType: input.mimeType || 'image/jpeg',
        data: input.imageBase64,
      },
    })
  }

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 3200 },
  }
  if (input.useSearch) {
    body.tools = [{ google_search: {} }]
  }

  let response: Response
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        config.geminiModel,
      )}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(input.timeoutMs ?? 60000),
      },
    )
  } catch (err) {
    console.error('[ai] request failed', err)
    throw new HttpError(502, 'The AI service could not be reached. Check the connection and try again.', {
      code: 'AI_UNREACHABLE',
    })
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('[ai] provider error', response.status, detail.slice(0, 500))
    throw new HttpError(
      response.status === 429 ? 429 : 502,
      response.status === 429
        ? 'The AI provider is rate limiting requests. Wait a moment and retry.'
        : 'The AI provider rejected the request.',
      { code: 'AI_PROVIDER_ERROR' },
    )
  }

  const data = (await response.json()) as GeminiResponse
  const candidate = data.candidates?.[0]
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .filter(Boolean)
    .join('\n')
    .trim()

  const sources: AiSource[] = []
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? []
  for (const chunk of chunks) {
    const web = chunk.web
    if (web?.uri && /^https?:\/\//.test(web.uri)) {
      sources.push({ title: web.title || web.uri, url: web.uri })
    }
  }

  if (!text) {
    throw new HttpError(502, 'The AI provider returned an empty response. Try again or use manual entry.', {
      code: 'AI_EMPTY_RESPONSE',
    })
  }

  return { text, sources: dedupeSources(sources), provider: 'gemini', model: config.geminiModel }
}

export function dedupeSources(sources: AiSource[]) {
  const seen = new Set<string>()
  return sources.filter((s) => {
    if (!s.url || seen.has(s.url)) return false
    seen.add(s.url)
    return true
  })
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, '```').trim()
  const fenced = cleaned.match(/```([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : cleaned
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>
    }
  }>
}
