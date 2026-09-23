import test from 'node:test'
import assert from 'node:assert/strict'
import { detectMediaMimeType } from '../apps/miniapp/src/platform/media.ts'

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex')).buffer

test('媒体类型按内容识别，不依赖临时文件扩展名', () => {
  assert.equal(detectMediaMimeType(bytes('ffd8ff00'), 'image'), 'image/jpeg')
  assert.equal(detectMediaMimeType(bytes('89504e470d0a1a0a'), 'image'), 'image/png')
  assert.equal(detectMediaMimeType(bytes('524946460000000057454250'), 'image'), 'image/webp')
  assert.equal(detectMediaMimeType(bytes('000000186674797069736f6d'), 'video'), 'video/mp4')
  assert.throws(() => detectMediaMimeType(bytes('89504e470d0a1a0a'), 'video'), /仅支持/)
  assert.throws(() => detectMediaMimeType(bytes('000000186674797069736f6d'), 'image'), /仅支持/)
})
