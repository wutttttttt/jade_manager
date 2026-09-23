import assert from 'node:assert/strict'
import test from 'node:test'
import { canView, quote, visibleGoods, type GoodsForViewer, type Viewer } from '../apps/api/src/domain.ts'

const goods: GoodsForViewer = {
  id: 'jade-1', publicVisible: false, publicPriceVisible: false, available: true,
  groupIds: ['vip-a'], listPriceCents: 20_000, floorPriceCents: 12_000,
}
const customer: Viewer = {
  customerId: 'customer-1', version: 1, groupIds: ['vip-a', 'vip-b'], coefficientBps: 8_000, grantedGoodsIds: [],
}

test('商品组只补充可见性，多个组按并集且不重复', () => {
  const second = { ...goods, id: 'jade-2', groupIds: ['vip-b'] }
  assert.deepEqual(visibleGoods([goods, second], customer).map((item) => item.id), ['jade-1', 'jade-2'])
  assert.equal(canView(goods, null), false)
})

test('单客商品授权补充组外可见性但不改变价格', () => {
  const outsider = { ...customer, groupIds: [], grantedGoodsIds: ['jade-1'] }
  assert.equal(canView(goods, outsider), true)
  assert.deepEqual(quote(goods, outsider, null), { priceCents: 16_000, priceYuan: 160, source: 'coefficient' })
})

test('单客价优先，最低价兜底，最终四舍五入到元', () => {
  assert.deepEqual(quote(goods, customer, 14_049), { priceCents: 14_000, priceYuan: 140, source: 'override' })
  assert.deepEqual(quote(goods, customer, 11_000), { priceCents: 12_000, priceYuan: 120, source: 'override' })
  assert.deepEqual(quote({ ...goods, floorPriceCents: 12_049 }, customer, 11_000),
    { priceCents: 12_100, priceYuan: 121, source: 'override' })
})

test('访客只能看公开货，商家可隐藏公开数字价', () => {
  const publicGoods = { ...goods, publicVisible: true }
  assert.equal(quote(publicGoods, null, null), null)
  assert.deepEqual(quote({ ...publicGoods, publicPriceVisible: true }, null, null),
    { priceCents: 20_000, priceYuan: 200, source: 'list' })
  assert.equal(canView({ ...publicGoods, available: false }, customer), false)
})

test('拒绝超出安全范围的金额与客户系数', () => {
  assert.throws(() => quote({ ...goods, listPriceCents: Number.MAX_SAFE_INTEGER }, customer, null), /金额/)
  assert.throws(() => quote(goods, { ...customer, coefficientBps: 100_001 }, null), /系数/)
})
