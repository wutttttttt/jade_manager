import type { GoodsCard } from '../api'

export const fallbackGoods: GoodsCard[] = [
  { id: 'demo-a001', code: 'A-001', name: '冰种平安扣', version: 1,
    attributes: { shape: '平安扣', color: '晴水' }, certificateSource: '合成证书样例 A001',
    quote: { priceYuan: 200, currency: 'CNY', display: 'numeric', version: '1:0:0' }, media: [] },
]
