export type GoodsForViewer = {
  id: string
  publicVisible: boolean
  publicPriceVisible: boolean
  available: boolean
  groupIds: string[]
  listPriceCents: number | null
  floorPriceCents: number | null
}

export type Viewer = {
  customerId: string
  version: number
  groupIds: string[]
  coefficientBps: number | null
  grantedGoodsIds: string[]
} | null

export const MAX_PRICE_CENTS = 10_000_000_000

export function canView(goods: GoodsForViewer, viewer: Viewer): boolean {
  if (!goods.available) return false
  if (goods.publicVisible) return true
  if (!viewer) return false
  return viewer.grantedGoodsIds.includes(goods.id)
    || goods.groupIds.some((id) => viewer.groupIds.includes(id))
}

export function quote(
  goods: GoodsForViewer,
  viewer: Viewer,
  overrideCents: number | null,
): { priceCents: number; priceYuan: number; source: 'override' | 'coefficient' | 'list' } | null {
  for (const value of [goods.listPriceCents, goods.floorPriceCents, overrideCents]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > MAX_PRICE_CENTS)) {
      throw new RangeError('金额超出安全范围')
    }
  }
  if (viewer?.coefficientBps !== null && viewer?.coefficientBps !== undefined
    && (!Number.isInteger(viewer.coefficientBps) || viewer.coefficientBps < 1 || viewer.coefficientBps > 100_000)) {
    throw new RangeError('客户系数超出安全范围')
  }
  if (!canView(goods, viewer)) return null
  if (!viewer && !goods.publicPriceVisible) return null

  let candidate = goods.listPriceCents
  let source: 'override' | 'coefficient' | 'list' = 'list'
  if (viewer && overrideCents !== null) {
    candidate = overrideCents
    source = 'override'
  } else if (viewer?.coefficientBps !== null && viewer?.coefficientBps !== undefined && candidate !== null) {
    candidate = Math.floor((candidate * viewer.coefficientBps + 5_000) / 10_000)
    source = 'coefficient'
  }
  if (candidate === null) return null

  const roundedCandidate = Math.floor((candidate + 50) / 100) * 100
  const roundedFloor = Math.ceil((goods.floorPriceCents ?? 0) / 100) * 100
  const priceCents = Math.max(roundedFloor, roundedCandidate)
  return { priceCents, priceYuan: priceCents / 100, source }
}

export function visibleGoods<T extends GoodsForViewer>(goods: T[], viewer: Viewer): T[] {
  return goods.filter((item) => canView(item, viewer))
}
