import test from 'node:test'
import assert from 'node:assert/strict'
import { detectMediaMimeType, downloadMediaImage } from '../apps/miniapp/src/platform/media.ts'

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex')).buffer

test('媒体类型按内容识别，不依赖临时文件扩展名', () => {
  assert.equal(detectMediaMimeType(bytes('ffd8ff00'), 'image'), 'image/jpeg')
  assert.equal(detectMediaMimeType(bytes('89504e470d0a1a0a'), 'image'), 'image/png')
  assert.equal(detectMediaMimeType(bytes('524946460000000057454250'), 'image'), 'image/webp')
  assert.equal(detectMediaMimeType(bytes('000000186674797069736f6d'), 'video'), 'video/mp4')
  assert.throws(() => detectMediaMimeType(bytes('89504e470d0a1a0a'), 'video'), /仅支持/)
  assert.throws(() => detectMediaMimeType(bytes('000000186674797069736f6d'), 'image'), /仅支持/)
})

test('图片下载只展示成功的受控响应，拒绝并清理撤权响应', async () => {
  const globals = globalThis as typeof globalThis & { uni?: unknown }
  const previous = globals.uni
  const removed: string[] = []
  let statusCode = 200
  globals.uni = {
    downloadFile(options: { url: string; success: (result: unknown) => void }) {
      assert.equal(options.url, 'http://192.0.2.1/media/private?customer=customer-multi')
      options.success({ statusCode, tempFilePath: '/tmp/downloaded-image' })
    },
    getFileSystemManager: () => ({ unlink: ({ filePath }: { filePath: string }) => removed.push(filePath) }),
  }
  try {
    const url = 'http://192.0.2.1/media/private?customer=customer-multi'
    assert.equal(await downloadMediaImage(url), '/tmp/downloaded-image')
    assert.deepEqual(removed, [])
    statusCode = 404
    await assert.rejects(downloadMediaImage(url), /图片暂不可用/)
    assert.deepEqual(removed, ['/tmp/downloaded-image'])
    globals.uni = { downloadFile: (options: { fail: () => void }) => options.fail() }
    await assert.rejects(downloadMediaImage(url), /图片加载失败/)
  } finally {
    if (previous === undefined) delete globals.uni
    else globals.uni = previous
  }
})
