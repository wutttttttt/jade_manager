import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import test from 'node:test'
import { readJson } from '../apps/api/src/request.ts'

const body = (text: string) => Readable.from([Buffer.from(text)]) as IncomingMessage

test('JSON 请求只接受对象并限制体积', async () => {
  assert.deepEqual(await readJson(body('{"name":"合成货品"}')), { name: '合成货品' })
  assert.deepEqual(await readJson(body('')), {})
  for (const input of ['null', '[]', '1', '"text"', '{']) {
    await assert.rejects(readJson(body(input)), { status: 400 })
  }
  await assert.rejects(readJson(body(' '.repeat(1_000_001))), { status: 413 })
})
