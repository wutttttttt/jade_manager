import test from 'node:test'
import assert from 'node:assert/strict'
import { scanGoodsCode } from '../apps/miniapp/src/platform/scan.ts'

test('微信条形码扫描保留字符串货号并处理取消、失败与长度边界', async () => {
  const globals = globalThis as typeof globalThis & { uni?: unknown }
  const previous = globals.uni
  let result = '001234'
  let failure: string | null = null
  globals.uni = {
    scanCode(options: {
      onlyFromCamera: boolean; scanType: string[]
      success: (result: { result: string }) => void
      fail: (error: { errMsg: string }) => void
    }) {
      assert.equal(options.onlyFromCamera, true)
      assert.deepEqual(options.scanType, ['barCode'])
      if (failure !== null) options.fail({ errMsg: failure })
      else options.success({ result })
    },
  }
  try {
    assert.equal(await scanGoodsCode(), '001234')
    result = 'A-004'
    assert.equal(await scanGoodsCode(), 'A-004')
    result = 'A'.repeat(40)
    assert.equal(await scanGoodsCode(), result)
    for (const invalid of ['', ' \t', 'A'.repeat(41)]) {
      result = invalid
      await assert.rejects(scanGoodsCode(), /不能为空且不能超过 40 个字符/)
    }
    failure = 'scanCode:fail cancel'
    assert.equal(await scanGoodsCode(), null)
    failure = 'scanCode:fail permission denied'
    await assert.rejects(scanGoodsCode(), /扫描失败，请重试或手动输入货号/)
    failure = 'scanCode:fail no camera'
    await assert.rejects(scanGoodsCode(), /扫描失败，请重试或手动输入货号/)
  } finally {
    if (previous === undefined) delete globals.uni
    else globals.uni = previous
  }
})
