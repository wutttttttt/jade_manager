export function validMediaSignature(mimeType: string, body: Buffer) {
  if (mimeType === 'image/jpeg') return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
  if (mimeType === 'image/png') return body.length >= 8 && body.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  if (mimeType === 'image/webp') return body.length >= 12
    && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP'
  if (mimeType === 'video/mp4') return body.length >= 12 && body.subarray(4, 8).toString('ascii') === 'ftyp'
  return false
}

export function parseByteRange(value: string | undefined, size: number) {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || size < 1) return false
  let start = match[1] ? Number(match[1]) : NaN
  let end = match[2] ? Number(match[2]) : NaN
  if (Number.isNaN(start)) {
    const suffix = end
    if (!Number.isSafeInteger(suffix) || suffix < 1) return false
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) return false
    if (Number.isNaN(end)) end = size - 1
    if (!Number.isSafeInteger(end) || end < start) return false
    end = Math.min(end, size - 1)
  }
  return { start, end }
}
