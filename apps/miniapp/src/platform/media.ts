export type LocalMedia = {
  path: string
  kind: 'image' | 'video'
  size: number
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4'
  requestId: string
}

export async function captureGoodsMedia(): Promise<LocalMedia[]> {
  const result = await uni.chooseMedia({ count: 9, mediaType: ['image', 'video'], sourceType: ['camera', 'album'] })
  const saved: LocalMedia[] = []
  try {
    for (const file of result.tempFiles) {
      if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('单个媒体必须在 20MB 以内')
      const mimeType = detectMediaMimeType(await readLocalMedia(file.tempFilePath), file.fileType)
      const path = await saveLocalFile(file.tempFilePath)
      saved.push({
        path,
        kind: file.fileType,
        size: file.size,
        mimeType,
        requestId: `media-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
    }
  } catch (error) {
    removeLocalMedia(saved)
    throw error
  }
  return saved
}

function saveLocalFile(tempFilePath: string): Promise<string> {
  return new Promise((resolve, reject) => uni.saveFile({
    tempFilePath,
    success: ({ savedFilePath }) => resolve(savedFilePath),
    fail: () => reject(new Error('本地素材保存失败，请清理小程序存储后重试')),
  }))
}

export function detectMediaMimeType(data: ArrayBuffer, kind: 'image' | 'video'): LocalMedia['mimeType'] {
  const bytes = new Uint8Array(data, 0, Math.min(data.byteLength, 12))
  const has = (offset: number, signature: number[]) => signature.every((value, index) => bytes[offset + index] === value)
  if (kind === 'image') {
    if (has(0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
    if (has(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
    if (has(0, [0x52, 0x49, 0x46, 0x46]) && has(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp'
  } else if (has(4, [0x66, 0x74, 0x79, 0x70])) return 'video/mp4'
  throw new Error('仅支持 JPEG、PNG、WebP 图片和 MP4 视频')
}

export function readLocalMedia(path: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    uni.getFileSystemManager().readFile({
      filePath: path,
      success: ({ data }) => typeof data === 'string' ? reject(new Error('媒体读取格式错误')) : resolve(data),
      fail: () => reject(new Error('媒体文件已失效，请重新选择')),
    })
  })
}

export function saveDraft(draft: unknown) {
  uni.setStorageSync('staff-goods-draft-v1', draft)
}

export function loadDraft<T>(): T | null {
  return uni.getStorageSync('staff-goods-draft-v1') || null
}

export function removeLocalMedia(media: LocalMedia[]) {
  for (const item of media) uni.removeSavedFile({ filePath: item.path })
}

export function clearDraft(media: LocalMedia[] = []) {
  removeLocalMedia(media)
  uni.removeStorageSync('staff-goods-draft-v1')
}
