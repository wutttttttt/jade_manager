import type { IncomingMessage } from 'node:http'
import { HttpError } from './store.ts'

export async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1_000_000) throw new HttpError(413, '请求体过大')
    chunks.push(chunk)
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object required')
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'JSON 请求体格式错误')
  }
}
