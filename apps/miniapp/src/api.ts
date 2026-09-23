export const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:3000'

export type GoodsCard = {
  id: string
  code: string
  name: string
  attributes: Record<string, string>
  certificateSource: string | null
  version: number
  quote: null | { priceYuan: number; currency: 'CNY'; display: 'numeric'; version: string }
  media: Array<{ id: string; kind: 'image' | 'video' }>
}

export type PublishingGoods = {
  id: string
  code: string
  name: string
  attributes: Record<string, string>
  certificateSource: string | null
  status: 'in_stock' | 'withdrawn'
  version: number
  media: Array<{ id: string; kind: 'image' | 'video'; status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; version: number }>
}

export type Batch = {
  id: string
  title: string
  status: 'draft' | 'published' | 'withdrawn'
  version: number
  publishedAt: string | null
  goodsIds: string[]
}

export type CustomerSettings = {
  id: string
  code: string
  name: string
  coefficientBps: number | null
  active: boolean
  version: number
  groupIds: string[]
  grantedGoodsIds: string[]
  overrides: Array<{ goodsId: string; priceCents: number; version: number }>
  requestId?: string
}

export type CustomerWorkspace = {
  customers: CustomerSettings[]
  groups: Array<{ id: string; name: string }>
  goods: Array<{
    id: string; code: string; name: string; status: 'in_stock' | 'withdrawn'; version: number
    publicVisible: boolean; publicPriceVisible: boolean; groupIds: string[]; requestId?: string
  }>
}

export type StaffMember = {
  id: string
  code: string
  name: string
  role: 'owner' | 'assistant'
  active: boolean
  version: number
  permissions: string[]
  requestId?: string
}

export type StaffWorkspace = { permissions: string[]; staff: StaffMember[] }

export type PricingGoods = {
  id: string
  code: string
  name: string
  version: number
  listPriceCents: number
  costPriceCents: number
  floorPriceCents: number
  requestId?: string
}

export async function loadShowroom(customer = '', batch = ''): Promise<{
  stall: { id: string; name: string; contact_phone: string | null }
  batch: { id: string; title: string; publishedAt: string } | null
  viewer: { code: string; recognized: boolean } | null
  goods: GoodsCard[]
}> {
  const query = [customer && `customer=${encodeURIComponent(customer)}`, batch && `batch=${encodeURIComponent(batch)}`]
    .filter(Boolean).join('&')
  const response = await uni.request({ url: `${API_BASE}/api/demo/yangmei-a/showroom${query ? `?${query}` : ''}` })
  if (response.statusCode !== 200) throw new Error('服务端暂不可用')
  return response.data as {
    stall: { id: string; name: string; contact_phone: string | null }
    batch: { id: string; title: string; publishedAt: string } | null
    viewer: { code: string; recognized: boolean } | null
    goods: GoodsCard[]
  }
}

export async function createGoods(input: Record<string, unknown>, requestId: string) {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/goods`, method: 'POST', data: input,
    header: { 'x-demo-staff': 'owner-a', 'idempotency-key': requestId },
  })
  if (response.statusCode !== 201) throw new Error((response.data as { error?: string }).error ?? '保存失败')
  return response.data as { id: string; code: string; name: string; attributes: Record<string, string>
    certificateSource: string | null; version: number }
}

export async function uploadMedia(goodsId: string, media: {
  kind: 'image' | 'video'; mimeType: string; requestId: string; data: ArrayBuffer
}) {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/media?goodsId=${encodeURIComponent(goodsId)}&kind=${media.kind}`,
    method: 'POST', data: media.data,
    header: { 'content-type': media.mimeType, 'x-demo-staff': 'owner-a', 'idempotency-key': media.requestId },
  })
  if (response.statusCode !== 201) throw new Error((response.data as { error?: string }).error ?? '媒体上传失败')
  return response.data
}

export async function reviewMedia(media: PublishingGoods['media'][number], status: 'approved' | 'rejected' | 'withdrawn') {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/media/${media.id}/review`, method: 'POST',
    data: { status, version: media.version },
    header: { 'x-demo-staff': 'owner-a', 'idempotency-key': `media-review-${media.id}-${media.version}-${status}` },
  })
  if (response.statusCode !== 200) throw new Error((response.data as { error?: string }).error ?? '审核失败')
  return response.data
}

export async function saveGoodsStatus(goods: PublishingGoods, status: 'in_stock' | 'withdrawn') {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/goods/${goods.id}`, method: 'PATCH',
    data: { status, version: goods.version },
    header: { 'x-demo-staff': 'owner-a',
      'idempotency-key': `goods-status-${goods.id}-${goods.version}-${status}` },
  })
  if (response.statusCode !== 200) throw new Error((response.data as { error?: string }).error ?? '更新货品状态失败')
  return response.data
}

export async function loadPublishing(): Promise<{ goods: PublishingGoods[]; batches: Batch[] }> {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/publishing`,
    header: { 'x-demo-staff': 'owner-a' },
  })
  if (response.statusCode !== 200) throw new Error((response.data as { error?: string }).error ?? '加载批次失败')
  return response.data as { goods: PublishingGoods[]; batches: Batch[] }
}

export async function loadCustomers(): Promise<CustomerWorkspace> {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/customers`, header: { 'x-demo-staff': 'owner-a' },
  })
  if (response.statusCode !== 200) throw new Error((response.data as { error?: string }).error ?? '加载客户失败')
  return response.data as CustomerWorkspace
}

export async function createAudienceGroup(name: string, requestId: string) {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/groups`, method: 'POST', data: { name },
    header: { 'x-demo-staff': 'owner-a', 'idempotency-key': requestId },
  })
  if (response.statusCode !== 201) throw new Error((response.data as { error?: string }).error ?? '创建商品组失败')
  return response.data as { id: string; name: string }
}

export async function loadStaff(): Promise<StaffWorkspace> {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/staff`, header: { 'x-demo-staff': 'owner-a' },
  })
  if (response.statusCode !== 200) throw new Error((response.data as { error?: string }).error ?? '加载员工失败')
  return response.data as StaffWorkspace
}

export async function createAssistant(code: string, name: string, requestId: string) {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/staff`, method: 'POST', data: { code, name },
    header: { 'x-demo-staff': 'owner-a', 'idempotency-key': requestId },
  })
  if (response.statusCode !== 201) throw new Error((response.data as { error?: string }).error ?? '新增员工失败')
  return response.data as StaffMember
}

export async function saveStaffAccess(staff: StaffMember) {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/staff/${staff.id}/access`, method: 'PUT',
    data: { version: staff.version, active: staff.active, permissions: staff.permissions },
    header: { 'x-demo-staff': 'owner-a',
      'idempotency-key': staff.requestId ?? `staff-access-${staff.id}-${staff.version}` },
  })
  if (response.statusCode !== 200) throw new Error((response.data as { error?: string }).error ?? '保存员工权限失败')
  return response.data
}

export async function loadPricing(): Promise<PricingGoods[]> {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/pricing`, header: { 'x-demo-staff': 'owner-a' },
  })
  if (response.statusCode !== 200) throw new Error((response.data as { error?: string }).error ?? '加载价格失败')
  return (response.data as { goods: PricingGoods[] }).goods
}

export async function saveGoodsPrices(goods: PricingGoods) {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/goods/${goods.id}/prices`, method: 'PUT',
    data: { version: goods.version, listPriceCents: Number(goods.listPriceCents),
      costPriceCents: Number(goods.costPriceCents), floorPriceCents: Number(goods.floorPriceCents) },
    header: { 'x-demo-staff': 'owner-a',
      'idempotency-key': goods.requestId ?? `goods-prices-${goods.id}-${goods.version}` },
  })
  if (response.statusCode !== 200) throw new Error((response.data as { error?: string }).error ?? '保存价格失败')
  return response.data
}

export async function saveCustomer(customer: CustomerSettings) {
  const coefficient = customer.coefficientBps
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/customers/${customer.id}/settings`, method: 'PUT',
    data: {
      version: customer.version,
      active: customer.active,
      coefficientBps: coefficient === null || String(coefficient).trim() === '' ? null : Number(coefficient),
      groupIds: customer.groupIds,
      grantedGoodsIds: customer.grantedGoodsIds,
    },
    header: { 'x-demo-staff': 'owner-a', 'idempotency-key': customer.requestId ?? `customer-${customer.id}-${customer.version}` },
  })
  if (response.statusCode !== 200) throw new Error((response.data as { error?: string }).error ?? '保存客户失败')
  return response.data
}

export async function saveGoodsAudience(goods: CustomerWorkspace['goods'][number]) {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/goods/${goods.id}/audience`, method: 'PUT',
    data: { version: goods.version, publicVisible: goods.publicVisible,
      publicPriceVisible: goods.publicPriceVisible, groupIds: goods.groupIds },
    header: { 'x-demo-staff': 'owner-a', 'idempotency-key': goods.requestId ?? `goods-audience-${goods.id}-${goods.version}` },
  })
  if (response.statusCode !== 200) throw new Error((response.data as { error?: string }).error ?? '保存商品可见范围失败')
  return response.data
}

export async function saveCustomerOverride(customer: CustomerSettings, goodsId: string,
  priceValue: string, requestId: string) {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/customers/${customer.id}/overrides/${goodsId}`, method: 'PUT',
    data: { customerVersion: customer.version,
      priceCents: priceValue.trim() === '' ? null : Number(priceValue) },
    header: { 'x-demo-staff': 'owner-a', 'idempotency-key': requestId },
  })
  if (response.statusCode !== 200) throw new Error((response.data as { error?: string }).error ?? '保存单客商品价失败')
  return response.data
}

export async function createBatchDraft(title: string, goodsIds: string[], requestId: string) {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/batches`, method: 'POST', data: { title, goodsIds },
    header: { 'x-demo-staff': 'owner-a', 'idempotency-key': requestId },
  })
  if (response.statusCode !== 201) throw new Error((response.data as { error?: string }).error ?? '保存批次失败')
  return response.data as Batch
}

export async function publishBatch(batch: Batch) {
  const response = await uni.request({
    url: `${API_BASE}/api/demo/yangmei-a/batches/${batch.id}/publish`, method: 'POST',
    data: { version: batch.version },
    header: { 'x-demo-staff': 'owner-a', 'idempotency-key': `batch-publish-${batch.id}-${batch.version}` },
  })
  if (response.statusCode !== 200) throw new Error((response.data as { error?: string }).error ?? '发布失败')
  return response.data as Batch
}
