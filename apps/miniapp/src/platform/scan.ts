export function scanGoodsCode(): Promise<string | null> {
  return new Promise((resolve, reject) => uni.scanCode({
    onlyFromCamera: true,
    scanType: ['barCode'],
    success: ({ result }) => {
      if (typeof result !== 'string' || !result.trim() || result.length > 40) {
        reject(new Error('条形码货号不能为空且不能超过 40 个字符，请重试或手动输入'))
        return
      }
      resolve(result)
    },
    fail: ({ errMsg }) => {
      if (errMsg?.includes('cancel')) return resolve(null)
      reject(new Error('扫描失败，请重试或手动输入货号'))
    },
  }))
}
