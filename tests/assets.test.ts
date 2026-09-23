import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { validMediaSignature } from '../apps/api/src/media.ts'

const root = new URL('../', import.meta.url)

test('合成媒体文件与种子大小和 SHA-256 一致', async () => {
  const seed = await readFile(new URL('apps/api/db/002_seed.sql', root), 'utf8')
  for (const name of ['jade-a001.svg', 'jade-a002.svg', 'demo-video.mp4']) {
    const content = await readFile(new URL(`var/media/${name}`, root))
    const checksum = createHash('sha256').update(content).digest('hex')
    assert.ok(seed.includes(`'${name}'`))
    assert.ok(seed.includes(`${content.length}, '${checksum}'`))
  }
})

test('集成上传 PNG 样例具有真实文件签名', async () => {
  const content = await readFile(new URL('var/media/demo-upload.png', root))
  assert.equal(validMediaSignature('image/png', content), true)
})
