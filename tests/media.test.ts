import test from 'node:test'
import assert from 'node:assert/strict'
import { parseByteRange, validMediaSignature } from '../apps/api/src/media.ts'
import { Store } from '../apps/api/src/store.ts'

test('媒体类型不信任请求头，必须匹配文件签名', () => {
  assert.equal(validMediaSignature('image/jpeg', Buffer.from('ffd8ff00', 'hex')), true)
  assert.equal(validMediaSignature('image/png', Buffer.from('89504e470d0a1a0a', 'hex')), true)
  assert.equal(validMediaSignature('image/webp', Buffer.from('524946460000000057454250', 'hex')), true)
  assert.equal(validMediaSignature('video/mp4', Buffer.from('000000186674797069736f6d', 'hex')), true)
  assert.equal(validMediaSignature('image/png', Buffer.from('not a png')), false)
  assert.equal(validMediaSignature('image/svg+xml', Buffer.from('<svg/>')), false)
})

test('媒体单区间读取支持起止、开放结尾和后缀长度', () => {
  assert.deepEqual(parseByteRange(undefined, 100), null)
  assert.deepEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19 })
  assert.deepEqual(parseByteRange('bytes=90-', 100), { start: 90, end: 99 })
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 })
  assert.equal(parseByteRange('bytes=100-', 100), false)
  assert.equal(parseByteRange('bytes=0-1,4-5', 100), false)
})

test('媒体落盘失败回滚事务，幂等重试仍完成落盘', async () => {
  const store = new Store('postgres://unused') as any
  const events: string[] = []
  const client = { query: async (sql: string) => {
    if (sql.startsWith('select id from goods')) return { rowCount: 1, rows: [{ id: 'goods' }] }
    if (sql.startsWith('insert into media_assets')) {
      events.push('insert')
      return { rowCount: 1, rows: [{ id: 'media', status: 'pending', version: 1 }] }
    }
    events.push('audit')
    return { rowCount: 1, rows: [] }
  } }
  store.authorize = async () => ({ staffId: 'staff', stallId: 'stall' })
  store.idempotent = async () => null
  store.saveIdempotent = async () => events.push('idempotency')
  store.transaction = async (run: (value: typeof client) => Promise<unknown>) => {
    events.push('begin')
    try {
      const result = await run(client)
      events.push('commit')
      return result
    } catch (error) {
      events.push('rollback')
      throw error
    }
  }
  const upload = (persist: () => Promise<void>) => store.createMedia('stall', 'staff',
    '40000000-0000-4000-8000-000000000001', 'image', 'asset.png', 'image/png', 8, 'a'.repeat(64),
    'media-request-1', persist)

  await assert.rejects(upload(async () => { events.push('persist'); throw new Error('disk full') }), /disk full/)
  assert.deepEqual(events, ['begin', 'insert', 'audit', 'idempotency', 'persist', 'rollback'])

  events.length = 0
  store.idempotent = async () => ({ id: 'media' })
  await upload(async () => { events.push('persist') })
  assert.deepEqual(events, ['begin', 'persist', 'commit'])
  await store.close()
})
