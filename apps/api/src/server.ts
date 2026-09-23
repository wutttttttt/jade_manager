import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { HttpError, Store } from './store.ts'
import { parseByteRange, validMediaSignature } from './media.ts'
import { readJson } from './request.ts'

const port = Number(process.env.PORT ?? 3000)
const apiHost = process.env.API_HOST ?? '127.0.0.1'
const demoMode = process.env.DEMO_MODE === '1' && process.env.NODE_ENV !== 'production'
const databaseUrl = process.env.DATABASE_URL
const mediaRoot = resolve(process.env.MEDIA_ROOT ?? './var/media')
if (!databaseUrl) throw new Error('缺少 DATABASE_URL')
const store = new Store(databaseUrl)

const json = (status: number, body: unknown) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' },
  body: JSON.stringify(body),
})

async function readBuffer(request: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 20 * 1024 * 1024) throw new HttpError(413, '媒体不能超过 20MB')
    chunks.push(chunk)
  }
  if (!size) throw new HttpError(400, '媒体内容为空')
  return Buffer.concat(chunks)
}

const mediaTypes: Record<string, { kind: 'image' | 'video'; extension: string }> = {
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/png': { kind: 'image', extension: 'png' },
  'image/webp': { kind: 'image', extension: 'webp' },
  'video/mp4': { kind: 'video', extension: 'mp4' },
}

async function serveMedia(
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
  media: { storage_key: string; mime_type: string },
) {
  const file = await readFile(resolve(mediaRoot, basename(media.storage_key)))
  const headers = { 'content-type': media.mime_type, 'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes' }
  const range = parseByteRange(request.headers.range, file.length)
  if (range === false) {
    response.writeHead(416, { ...headers, 'content-range': `bytes */${file.length}` }).end()
  } else if (range) {
    const body = file.subarray(range.start, range.end + 1)
    response.writeHead(206, { ...headers, 'content-range': `bytes ${range.start}-${range.end}/${file.length}`,
      'content-length': body.length }).end(body)
  } else {
    response.writeHead(200, { ...headers, 'content-length': file.length }).end(file)
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (url.pathname === '/health') {
      const db = await store.health()
      const result = json(200, { status: 'ready', database: db.database })
      response.writeHead(result.status, result.headers).end(result.body)
      return
    }
    if (!demoMode || !url.pathname.startsWith('/api/demo/')) throw new HttpError(404, 'not found')
    const parts = url.pathname.split('/').filter(Boolean)
    const stallSlug = parts[2]
    let result
    if (request.method === 'GET' && parts[3] === 'showroom') {
      const view = await store.showroom(stallSlug, url.searchParams.get('customer') ?? undefined,
        url.searchParams.get('batch') ?? undefined)
      if (!view) throw new HttpError(404, '档口不存在')
      result = json(200, view)
    } else if (request.method === 'POST' && parts[3] === 'media' && !parts[4]) {
      const mimeType = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      const mediaType = mediaTypes[mimeType]
      const kind = url.searchParams.get('kind')
      const goodsId = url.searchParams.get('goodsId') ?? ''
      const requestId = String(request.headers['idempotency-key'] ?? '')
      if (!mediaType || kind !== mediaType.kind) throw new HttpError(415, '不支持的媒体类型')
      if (requestId.length < 8 || requestId.length > 200) throw new HttpError(400, '缺少有效 Idempotency-Key')
      const body = await readBuffer(request)
      if (!validMediaSignature(mimeType, body)) throw new HttpError(415, '媒体内容与声明格式不匹配')
      const checksum = createHash('sha256').update(body).digest('hex')
      const fileStem = createHash('sha256').update(`${stallSlug}:${requestId}`).digest('hex')
      const storageKey = `${fileStem}.${mediaType.extension}`
      const temporaryPath = resolve(mediaRoot, `${storageKey}.${randomUUID()}.part`)
      await mkdir(mediaRoot, { recursive: true })
      try {
        // ponytail: 进程在 writeFile 后崩溃可残留 .part；有常驻部署和存储指标时再加启动清理。
        await writeFile(temporaryPath, body)
        // ponytail: 提交结果不明时可能留下无数据库引用的成品；常驻部署后用定期对账清理。
        const value = await store.createMedia(stallSlug, String(request.headers['x-demo-staff'] ?? ''),
          goodsId, mediaType.kind, storageKey, mimeType, body.length, checksum, requestId,
          () => rename(temporaryPath, resolve(mediaRoot, storageKey)))
        result = json(201, value)
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined)
        throw error
      }
    } else if (request.method === 'POST' && parts[3] === 'media' && parts[4] && parts[5] === 'review') {
      const body = await readJson(request)
      const value = await store.reviewMedia(stallSlug, String(request.headers['x-demo-staff'] ?? ''), parts[4],
        String(body.status), Number(body.version), String(request.headers['idempotency-key'] ?? ''))
      result = json(200, value)
    } else if (request.method === 'GET' && parts[3] === 'media' && parts[4] && parts[5] === 'review-file') {
      const media = await store.staffMedia(stallSlug, url.searchParams.get('staff') ?? '', parts[4])
      if (!media) throw new HttpError(404, '媒体不可访问')
      await serveMedia(request, response, media)
      return
    } else if (request.method === 'GET' && parts[3] === 'media' && parts[4]) {
      const media = await store.media(stallSlug, parts[4], url.searchParams.get('customer') ?? undefined)
      if (!media) throw new HttpError(404, '媒体不可访问')
      await serveMedia(request, response, media)
      return
    } else if (request.method === 'POST' && parts[3] === 'goods') {
      const body = await readJson(request)
      const value = await store.createGoods(stallSlug, String(request.headers['x-demo-staff'] ?? ''), body,
        String(request.headers['idempotency-key'] ?? ''))
      result = json(201, value)
    } else if (request.method === 'PUT' && parts[3] === 'goods' && parts[4] && parts[5] === 'audience') {
      const body = await readJson(request)
      const value = await store.updateGoodsAudience(stallSlug, String(request.headers['x-demo-staff'] ?? ''),
        parts[4], body, String(request.headers['idempotency-key'] ?? ''))
      result = json(200, value)
    } else if (request.method === 'PUT' && parts[3] === 'goods' && parts[4] && parts[5] === 'prices') {
      const body = await readJson(request)
      const value = await store.updateGoodsPrices(stallSlug, String(request.headers['x-demo-staff'] ?? ''),
        parts[4], body, String(request.headers['idempotency-key'] ?? ''))
      result = json(200, value)
    } else if (request.method === 'PATCH' && parts[3] === 'goods' && parts[4]) {
      const body = await readJson(request)
      const value = await store.updateGoodsStatus(stallSlug, String(request.headers['x-demo-staff'] ?? ''),
        parts[4], String(body.status), Number(body.version), String(request.headers['idempotency-key'] ?? ''))
      result = json(200, value)
    } else if (request.method === 'GET' && parts[3] === 'publishing') {
      const value = await store.publishingWorkspace(stallSlug, String(request.headers['x-demo-staff'] ?? ''))
      result = json(200, value)
    } else if (request.method === 'GET' && parts[3] === 'pricing') {
      const value = await store.pricingWorkspace(stallSlug, String(request.headers['x-demo-staff'] ?? ''))
      result = json(200, value)
    } else if (request.method === 'GET' && parts[3] === 'staff' && !parts[4]) {
      const value = await store.staffWorkspace(stallSlug, String(request.headers['x-demo-staff'] ?? ''))
      result = json(200, value)
    } else if (request.method === 'POST' && parts[3] === 'staff' && !parts[4]) {
      const body = await readJson(request)
      const value = await store.createAssistant(stallSlug, String(request.headers['x-demo-staff'] ?? ''), body,
        String(request.headers['idempotency-key'] ?? ''))
      result = json(201, value)
    } else if (request.method === 'PUT' && parts[3] === 'staff' && parts[4] && parts[5] === 'access') {
      const body = await readJson(request)
      const value = await store.updateStaffAccess(stallSlug, String(request.headers['x-demo-staff'] ?? ''),
        parts[4], body, String(request.headers['idempotency-key'] ?? ''))
      result = json(200, value)
    } else if (request.method === 'GET' && parts[3] === 'customers' && !parts[4]) {
      const value = await store.customerWorkspace(stallSlug, String(request.headers['x-demo-staff'] ?? ''))
      result = json(200, value)
    } else if (request.method === 'POST' && parts[3] === 'groups' && !parts[4]) {
      const body = await readJson(request)
      const value = await store.createAudienceGroup(stallSlug, String(request.headers['x-demo-staff'] ?? ''),
        body.name, String(request.headers['idempotency-key'] ?? ''))
      result = json(201, value)
    } else if (request.method === 'PUT' && parts[3] === 'customers' && parts[4] && parts[5] === 'settings') {
      const body = await readJson(request)
      const value = await store.updateCustomerSettings(stallSlug, String(request.headers['x-demo-staff'] ?? ''),
        parts[4], body, String(request.headers['idempotency-key'] ?? ''))
      result = json(200, value)
    } else if (request.method === 'PUT' && parts[3] === 'customers' && parts[4]
      && parts[5] === 'overrides' && parts[6]) {
      const body = await readJson(request)
      const value = await store.updateCustomerOverride(stallSlug, String(request.headers['x-demo-staff'] ?? ''),
        parts[4], parts[6], body, String(request.headers['idempotency-key'] ?? ''))
      result = json(200, value)
    } else if (request.method === 'POST' && parts[3] === 'batches' && !parts[4]) {
      const body = await readJson(request)
      const value = await store.createBatchDraft(stallSlug, String(request.headers['x-demo-staff'] ?? ''),
        body.title, body.goodsIds as string[], String(request.headers['idempotency-key'] ?? ''))
      result = json(201, value)
    } else if (request.method === 'POST' && parts[3] === 'batches' && parts[4] && parts[5] === 'publish') {
      const body = await readJson(request)
      const value = await store.publishBatch(stallSlug, String(request.headers['x-demo-staff'] ?? ''),
        parts[4], Number(body.version), String(request.headers['idempotency-key'] ?? ''))
      result = json(200, value)
    } else throw new HttpError(404, 'not found')
    response.writeHead(result.status, result.headers).end(result.body)
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    if (status === 500) console.error(error)
    const result = json(status, { error: error instanceof HttpError ? error.message : 'internal error' })
    response.writeHead(result.status, result.headers).end(result.body)
  }
})

server.listen(port, apiHost, () => console.log(`jade api ready at http://${apiHost}:${port}`))

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
  server.close()
  await store.close()
})
