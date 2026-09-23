import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const base = process.env.API_BASE ?? 'http://127.0.0.1:3000'
const owner = { 'x-demo-staff': 'owner-a' }
const a1 = '40000000-0000-4000-8000-000000000001'
const a2 = '40000000-0000-4000-8000-000000000002'
const a3 = '40000000-0000-4000-8000-000000000003'

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options)
  const body = await response.json()
  return { response, body }
}

function post(path, body, requestId, extraHeaders = owner) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': requestId, ...extraHeaders },
    body: JSON.stringify(body),
  })
}

const health = await request('/health')
assert.equal(health.response.status, 200)
assert.deepEqual(health.body, { status: 'ready', database: 'jade_manager' })
assert.equal(health.response.headers.get('cache-control'), 'no-store')

const visitor = await request('/api/demo/yangmei-a/showroom')
assert.equal(visitor.response.status, 200)
assert.deepEqual(visitor.body.goods.map((item) => item.code), ['A-001'])
assert.equal(visitor.body.goods[0].quote.priceYuan, 200)
assert.equal(visitor.body.goods[0].quote.currency, 'CNY')
assert.equal(typeof visitor.body.goods[0].quote.version, 'string')
assert.equal('source' in visitor.body.goods[0].quote, false)
assert.equal('priceCents' in visitor.body.goods[0].quote, false)
assert.deepEqual(visitor.body.goods[0].attributes, { color: '晴水', shape: '平安扣' })
assert.equal(visitor.body.goods[0].certificateSource, '合成证书样例 A001')

const multi = await request('/api/demo/yangmei-a/showroom?customer=customer-multi')
assert.deepEqual(multi.body.goods.map((item) => item.code), ['A-001', 'A-002', 'A-003'])
assert.equal(multi.body.goods[0].quote.priceYuan, 120)
assert.equal(multi.body.goods[1].quote.priceYuan, 7040)

const grant = await request('/api/demo/yangmei-a/showroom?customer=customer-grant')
assert.deepEqual(grant.body.goods.map((item) => item.code), ['A-001', 'A-002', 'A-003'])
assert.equal(grant.body.goods[2].quote.priceYuan, 3240)

const otherStall = await request('/api/demo/yangmei-b/showroom')
assert.deepEqual(otherStall.body.goods.map((item) => item.code), ['B-001'])
assert.equal(otherStall.body.goods[0].quote, null)

const publicMedia = await fetch(`${base}/api/demo/yangmei-a/media/50000000-0000-4000-8000-000000000001`)
assert.equal(publicMedia.status, 200)
assert.equal(publicMedia.headers.get('cache-control'), 'private, no-store')
const rangedMedia = await fetch(`${base}/api/demo/yangmei-a/media/50000000-0000-4000-8000-000000000001`,
  { headers: { range: 'bytes=0-9' } })
assert.equal(rangedMedia.status, 206)
assert.equal((await rangedMedia.arrayBuffer()).byteLength, 10)
assert.equal((await fetch(`${base}/api/demo/yangmei-a/media/50000000-0000-4000-8000-000000000001`,
  { headers: { range: 'bytes=999999-' } })).status, 416)
assert.equal((await fetch(`${base}/api/demo/yangmei-a/media/50000000-0000-4000-8000-000000000003?customer=customer-grant`)).status, 404)
assert.equal((await fetch(`${base}/api/demo/yangmei-a/media/50000000-0000-4000-8000-000000000003/review-file?staff=owner-a`)).status, 200)
assert.equal((await fetch(`${base}/api/demo/yangmei-a/media/50000000-0000-4000-8000-000000000003/review-file?staff=assistant-a`)).status, 403)

const forbidden = await request('/api/demo/yangmei-a/publishing', { headers: { 'x-demo-staff': 'assistant-a' } })
assert.equal(forbidden.response.status, 403)

const workspace = await request('/api/demo/yangmei-a/publishing', { headers: owner })
assert.equal(workspace.response.status, 200)
assert.ok(workspace.body.batches.length >= 2)

const createdGoodsInput = { code: 'INTEGRATION-ATTR', name: '基础属性验收货品', shape: '蛋面', color: '绿色',
  certificateSource: '合成集成证书', listPriceCents: 20000, costPriceCents: 10000,
  floorPriceCents: 12000, publicVisible: false, publicPriceVisible: false }
const createdGoods = await post('/api/demo/yangmei-a/goods', createdGoodsInput, 'integration-goods-attributes-v1')
assert.equal(createdGoods.response.status, 201)
assert.deepEqual(createdGoods.body.attributes, { shape: '蛋面', color: '绿色' })
assert.equal(createdGoods.body.certificateSource, '合成集成证书')
const createdGoodsRetry = await post('/api/demo/yangmei-a/goods', createdGoodsInput, 'integration-goods-attributes-v1')
assert.equal(createdGoodsRetry.body.id, createdGoods.body.id)
const duplicateGoods = await post('/api/demo/yangmei-a/goods', createdGoodsInput, 'integration-goods-duplicate-v1')
assert.equal(duplicateGoods.response.status, 409)
const invalidVisibility = await post('/api/demo/yangmei-a/goods',
  { ...createdGoodsInput, code: 'INTEGRATION-BAD-BOOL', publicVisible: 'false' }, 'integration-goods-bad-bool-v1')
assert.equal(invalidVisibility.response.status, 400)
const reopenedGoods = (await request('/api/demo/yangmei-a/publishing', { headers: owner })).body.goods
  .find((item) => item.id === createdGoods.body.id)
assert.deepEqual(reopenedGoods.attributes, { shape: '蛋面', color: '绿色' })
assert.equal(reopenedGoods.certificateSource, '合成集成证书')

const pricingForbidden = await request('/api/demo/yangmei-a/pricing', { headers: { 'x-demo-staff': 'assistant-a' } })
assert.equal(pricingForbidden.response.status, 403)
let priceGoods = (await request('/api/demo/yangmei-a/pricing', { headers: owner })).body.goods
  .find((item) => item.id === a1)
async function updatePrices(listPriceCents, costPriceCents, floorPriceCents) {
  const result = await request(`/api/demo/yangmei-a/goods/${a1}/prices`, {
    method: 'PUT', headers: { ...owner, 'content-type': 'application/json',
      'idempotency-key': `integration-prices-${priceGoods.version}-${listPriceCents}` },
    body: JSON.stringify({ version: priceGoods.version, listPriceCents, costPriceCents, floorPriceCents }),
  })
  assert.equal(result.response.status, 200)
  priceGoods = result.body
}
await updatePrices(21000, 10000, 12000)
assert.equal((await request('/api/demo/yangmei-a/showroom')).body.goods[0].quote.priceYuan, 210)
assert.equal((await request('/api/demo/yangmei-a/showroom?customer=customer-grant')).body.goods[0].quote.priceYuan, 189)
await updatePrices(20000, 10000, 12000)

const uploadBody = await readFile(new URL('../var/media/demo-upload.png', import.meta.url))
const disguisedMedia = await request('/api/demo/yangmei-a/media?goodsId=40000000-0000-4000-8000-000000000001&kind=image', {
  method: 'POST',
  headers: { ...owner, 'content-type': 'image/png', 'idempotency-key': 'integration-invalid-media-v1' },
  body: Buffer.from('not a png'),
})
assert.equal(disguisedMedia.response.status, 415)
const uploadOptions = {
  method: 'POST',
  headers: { ...owner, 'content-type': 'image/png', 'idempotency-key': 'integration-media-upload-v1' },
  body: uploadBody,
}
const uploaded = await request('/api/demo/yangmei-a/media?goodsId=40000000-0000-4000-8000-000000000001&kind=image', uploadOptions)
assert.equal(uploaded.response.status, 201)
const uploadRetry = await request('/api/demo/yangmei-a/media?goodsId=40000000-0000-4000-8000-000000000001&kind=image', uploadOptions)
assert.equal(uploadRetry.body.id, uploaded.body.id)

async function setMediaStatus(asset, status) {
  const result = await post(`/api/demo/yangmei-a/media/${asset.id}/review`,
    { status, version: asset.version }, `integration-media-${asset.id}-${asset.version}-${status}`)
  assert.equal(result.response.status, 200)
  return result.body
}

let uploadedState = (await request('/api/demo/yangmei-a/publishing', { headers: owner })).body.goods
  .flatMap((goods) => goods.media).find((asset) => asset.id === uploaded.body.id)
uploadedState = await setMediaStatus(uploadedState, 'rejected')
assert.equal((await fetch(`${base}/api/demo/yangmei-a/media/${uploaded.body.id}`)).status, 404)
uploadedState = await setMediaStatus(uploadedState, 'approved')
assert.equal((await fetch(`${base}/api/demo/yangmei-a/media/${uploaded.body.id}`)).status, 200)
uploadedState = await setMediaStatus(uploadedState, 'withdrawn')
assert.equal((await fetch(`${base}/api/demo/yangmei-a/media/${uploaded.body.id}`)).status, 404)
uploadedState = await setMediaStatus(uploadedState, 'approved')
assert.equal((await fetch(`${base}/api/demo/yangmei-a/media/${uploaded.body.id}`)).status, 200)

const videoBody = await readFile(new URL('../var/media/demo-video.mp4', import.meta.url))
const uploadedVideo = await request('/api/demo/yangmei-a/media?goodsId=40000000-0000-4000-8000-000000000001&kind=video', {
  method: 'POST', headers: { ...owner, 'content-type': 'video/mp4', 'idempotency-key': 'integration-video-upload-v1' },
  body: videoBody,
})
assert.equal(uploadedVideo.response.status, 201)
const videoState = (await request('/api/demo/yangmei-a/publishing', { headers: owner })).body.goods
  .flatMap((goods) => goods.media).find((asset) => asset.id === uploadedVideo.body.id)
if (videoState.status !== 'approved') {
  assert.equal((await fetch(`${base}/api/demo/yangmei-a/media/${uploadedVideo.body.id}`)).status, 404)
  await setMediaStatus(videoState, 'approved')
}
const videoUrl = `${base}/api/demo/yangmei-a/media/${uploadedVideo.body.id}`
const approvedVideo = await fetch(videoUrl, { headers: { range: 'bytes=0-9' } })
assert.equal(approvedVideo.status, 206)
assert.equal(approvedVideo.headers.get('content-type'), 'video/mp4')
assert.equal((await approvedVideo.arrayBuffer()).byteLength, 10)
assert.equal((await request('/api/demo/yangmei-a/showroom')).body.goods[0].media
  .some((asset) => asset.id === uploadedVideo.body.id && asset.kind === 'video'), true)

const staffForbidden = await request('/api/demo/yangmei-a/staff', { headers: { 'x-demo-staff': 'assistant-a' } })
assert.equal(staffForbidden.response.status, 403)
const newAssistant = await post('/api/demo/yangmei-a/staff',
  { code: 'assistant-integration', name: '集成测试伙计' }, 'integration-assistant-create-v1')
assert.equal(newAssistant.response.status, 201)
assert.deepEqual(newAssistant.body.permissions, [])
const newAssistantRetry = await post('/api/demo/yangmei-a/staff',
  { code: 'assistant-integration', name: '集成测试伙计' }, 'integration-assistant-create-v1')
assert.equal(newAssistantRetry.body.id, newAssistant.body.id)
const staffWorkspace = await request('/api/demo/yangmei-a/staff', { headers: owner })
assert.equal(staffWorkspace.response.status, 200)
let assistant = staffWorkspace.body.staff.find((item) => item.code === 'assistant-a')
async function updateAssistant(permissions, active = true) {
  const result = await request(`/api/demo/yangmei-a/staff/${assistant.id}/access`, {
    method: 'PUT', headers: { ...owner, 'content-type': 'application/json',
      'idempotency-key': `integration-staff-${assistant.version}-${active}-${permissions.join('-')}` },
    body: JSON.stringify({ version: assistant.version, active, permissions }),
  })
  assert.equal(result.response.status, 200)
  assistant = result.body
}
await updateAssistant(['goods.edit', 'customer.manage'])
const assistantGroup = await post('/api/demo/yangmei-a/groups', { name: '伙计权限检查组' },
  `integration-assistant-group-${assistant.version}`, { 'x-demo-staff': 'assistant-a' })
assert.equal(assistantGroup.response.status, 201)
await updateAssistant(['goods.edit', 'customer.manage'], false)
const disabledAssistant = await post('/api/demo/yangmei-a/groups', { name: '停用伙计不可创建' },
  `integration-disabled-assistant-${assistant.version}`, { 'x-demo-staff': 'assistant-a' })
assert.equal(disabledAssistant.response.status, 403)
await updateAssistant(['goods.edit', 'customer.manage'])
const selfElevation = await request(`/api/demo/yangmei-a/staff/${assistant.id}/access`, {
  method: 'PUT', headers: { 'x-demo-staff': 'assistant-a', 'content-type': 'application/json',
    'idempotency-key': `integration-self-elevation-${assistant.version}` },
  body: JSON.stringify({ version: assistant.version, active: true, permissions: ['media.publish'] }),
})
assert.equal(selfElevation.response.status, 403)
await updateAssistant(['price.list.edit'])
const assistantPricing = await request('/api/demo/yangmei-a/pricing', { headers: { 'x-demo-staff': 'assistant-a' } })
assert.equal(assistantPricing.response.status, 200)
let assistantPriceGoods = assistantPricing.body.goods.find((item) => item.id === a1)
assert.equal(assistantPriceGoods.listPriceCents, 20000)
assert.equal('costPriceCents' in assistantPriceGoods, false)
assert.equal('floorPriceCents' in assistantPriceGoods, false)
const assistantPriceUpdate = await request(`/api/demo/yangmei-a/goods/${a1}/prices`, {
  method: 'PUT', headers: { 'x-demo-staff': 'assistant-a', 'content-type': 'application/json',
    'idempotency-key': `integration-assistant-list-price-${assistantPriceGoods.version}` },
  body: JSON.stringify({ version: assistantPriceGoods.version, listPriceCents: 20500 }),
})
assert.equal(assistantPriceUpdate.response.status, 200)
assistantPriceGoods = assistantPriceUpdate.body
assert.equal(assistantPriceGoods.listPriceCents, 20500)
assert.equal('costPriceCents' in assistantPriceGoods, false)
const assistantCostUpdate = await request(`/api/demo/yangmei-a/goods/${a1}/prices`, {
  method: 'PUT', headers: { 'x-demo-staff': 'assistant-a', 'content-type': 'application/json',
    'idempotency-key': `integration-assistant-cost-price-${assistantPriceGoods.version}` },
  body: JSON.stringify({ version: assistantPriceGoods.version, costPriceCents: 9000 }),
})
assert.equal(assistantCostUpdate.response.status, 403)
const ownerPriceRestore = await request(`/api/demo/yangmei-a/goods/${a1}/prices`, {
  method: 'PUT', headers: { ...owner, 'content-type': 'application/json',
    'idempotency-key': `integration-owner-list-price-restore-${assistantPriceGoods.version}` },
  body: JSON.stringify({ version: assistantPriceGoods.version, listPriceCents: 20000 }),
})
assert.equal(ownerPriceRestore.response.status, 200)
await updateAssistant(['goods.edit'])

const customerForbidden = await request('/api/demo/yangmei-a/customers', { headers: { 'x-demo-staff': 'assistant-a' } })
assert.equal(customerForbidden.response.status, 403)
const createdGroup = await post('/api/demo/yangmei-a/groups', { name: '集成测试组' }, 'integration-audience-group-v1')
assert.equal(createdGroup.response.status, 201)
const groupRetry = await post('/api/demo/yangmei-a/groups', { name: '集成测试组' }, 'integration-audience-group-v1')
assert.equal(groupRetry.body.id, createdGroup.body.id)
let customerWorkspace = (await request('/api/demo/yangmei-a/customers', { headers: owner })).body
let customer = customerWorkspace.customers.find((item) => item.code === 'customer-list')
const familiarGroup = customerWorkspace.groups.find((item) => item.name === '熟客').id
const liveGroup = customerWorkspace.groups.find((item) => item.name === '直播客户').id
let audienceGoods = customerWorkspace.goods.find((item) => item.id === a2)
const groupMediaUrl = `${base}/api/demo/yangmei-a/media/50000000-0000-4000-8000-000000000002?customer=customer-grant`
assert.equal((await fetch(groupMediaUrl)).status, 200)
async function updateAudience(groupIds) {
  const result = await request(`/api/demo/yangmei-a/goods/${audienceGoods.id}/audience`, {
    method: 'PUT',
    headers: { ...owner, 'content-type': 'application/json',
      'idempotency-key': `integration-audience-${audienceGoods.id}-${audienceGoods.version}-${groupIds.join('-')}` },
    body: JSON.stringify({ version: audienceGoods.version, publicVisible: false,
      publicPriceVisible: false, groupIds }),
  })
  assert.equal(result.response.status, 200)
  audienceGoods = result.body
}
await updateAudience([liveGroup])
const familiarOnly = await request('/api/demo/yangmei-a/showroom?customer=customer-grant')
assert.deepEqual(familiarOnly.body.goods.map((item) => item.code), ['A-001', 'A-003'])
assert.equal((await fetch(groupMediaUrl)).status, 404)
assert.equal((await request('/api/demo/yangmei-a/showroom?customer=customer-multi')).body.goods[1].quote.priceYuan, 7040)
await updateAudience([familiarGroup])
assert.equal((await fetch(groupMediaUrl)).status, 200)

async function updateCustomer(next) {
  const payload = { active: customer.active, ...next }
  const result = await request(`/api/demo/yangmei-a/customers/${customer.id}/settings`, {
    method: 'PUT',
    headers: { ...owner, 'content-type': 'application/json',
      'idempotency-key': `integration-customer-${customer.version}-${payload.active}-${payload.coefficientBps}-${payload.groupIds.length}-${payload.grantedGoodsIds.length}` },
    body: JSON.stringify({ version: customer.version, ...payload }),
  })
  assert.equal(result.response.status, 200)
  customer = result.body
}
await updateCustomer({ coefficientBps: null, groupIds: [familiarGroup], grantedGoodsIds: [a3] })
let customerView = await request('/api/demo/yangmei-a/showroom?customer=customer-list')
assert.deepEqual(customerView.body.goods.map((item) => item.code), ['A-001', 'A-002', 'A-003'])
assert.equal(customerView.body.goods[1].quote.priceYuan, 8800)
await updateCustomer({ coefficientBps: 7500, groupIds: customer.groupIds, grantedGoodsIds: customer.grantedGoodsIds })
customerView = await request('/api/demo/yangmei-a/showroom?customer=customer-list')
assert.equal(customerView.body.goods[1].quote.priceYuan, 6600)
await updateCustomer({ coefficientBps: 7500, groupIds: [], grantedGoodsIds: [] })
customerView = await request('/api/demo/yangmei-a/showroom?customer=customer-list')
assert.deepEqual(customerView.body.goods.map((item) => item.code), ['A-001'])
assert.equal(customerView.body.goods[0].quote.priceYuan, 150)
await updateCustomer({ coefficientBps: null, groupIds: [], grantedGoodsIds: [] })
await updateCustomer({ coefficientBps: null, groupIds: [familiarGroup], grantedGoodsIds: [] })
assert.deepEqual((await request('/api/demo/yangmei-a/showroom?customer=customer-list')).body.goods
  .map((item) => item.code), ['A-001', 'A-002'])
const privateMediaUrl = `${base}/api/demo/yangmei-a/media/50000000-0000-4000-8000-000000000002?customer=customer-list`
assert.equal((await fetch(privateMediaUrl)).status, 200)
await updateCustomer({ active: false, coefficientBps: customer.coefficientBps,
  groupIds: customer.groupIds, grantedGoodsIds: customer.grantedGoodsIds })
const inactiveCustomerView = await request('/api/demo/yangmei-a/showroom?customer=customer-list')
assert.equal(inactiveCustomerView.body.viewer.recognized, false)
assert.deepEqual(inactiveCustomerView.body.goods.map((item) => item.code), ['A-001'])
assert.equal((await fetch(privateMediaUrl)).status, 404)
await updateCustomer({ active: true, coefficientBps: customer.coefficientBps,
  groupIds: customer.groupIds, grantedGoodsIds: customer.grantedGoodsIds })
assert.equal((await request('/api/demo/yangmei-a/showroom?customer=customer-list')).body.viewer.recognized, true)
assert.equal((await fetch(privateMediaUrl)).status, 200)
await updateCustomer({ coefficientBps: null, groupIds: [], grantedGoodsIds: [] })

async function updateOverride(priceCents) {
  const result = await request(`/api/demo/yangmei-a/customers/${customer.id}/overrides/${a1}`, {
    method: 'PUT',
    headers: { ...owner, 'content-type': 'application/json',
      'idempotency-key': `integration-override-${customer.version}-${priceCents ?? 'clear'}` },
    body: JSON.stringify({ customerVersion: customer.version, priceCents }),
  })
  assert.equal(result.response.status, 200)
  customer.version = result.body.customerVersion
}
await updateOverride(11000)
assert.equal((await request('/api/demo/yangmei-a/showroom?customer=customer-list')).body.goods[0].quote.priceYuan, 120)
await updateOverride(null)
assert.equal((await request('/api/demo/yangmei-a/showroom?customer=customer-list')).body.goods[0].quote.priceYuan, 200)

const draftInput = { title: '集成检查批次', goodsIds: [a1, a2] }
const draft = await post('/api/demo/yangmei-a/batches', draftInput, 'integration-draft-v1')
assert.equal(draft.response.status, 201)
assert.equal(draft.body.status, 'draft')
const draftRetry = await post('/api/demo/yangmei-a/batches', draftInput, 'integration-draft-v1')
assert.equal(draftRetry.body.id, draft.body.id)
const storedDraft = (await request('/api/demo/yangmei-a/publishing', { headers: owner })).body.batches
  .find((item) => item.id === draft.body.id)
if (storedDraft.status === 'draft') {
  const unpublishedBatch = await request(`/api/demo/yangmei-a/showroom?customer=customer-multi&batch=${draft.body.id}`)
  assert.equal(unpublishedBatch.response.status, 404)
}

const published = await post(`/api/demo/yangmei-a/batches/${draft.body.id}/publish`,
  { version: draft.body.version }, 'integration-publish-v1')
assert.equal(published.response.status, 200)
assert.equal(published.body.status, 'published')
const publishRetry = await post(`/api/demo/yangmei-a/batches/${draft.body.id}/publish`,
  { version: draft.body.version }, 'integration-publish-v1')
assert.equal(publishRetry.body.id, published.body.id)
let batchView = await request(`/api/demo/yangmei-a/showroom?customer=customer-multi&batch=${draft.body.id}`)
assert.equal(batchView.response.status, 200)
assert.equal(batchView.body.batch.title, draftInput.title)
assert.deepEqual(batchView.body.goods.map((item) => item.code), ['A-001', 'A-002'])
const visitorBatch = await request(`/api/demo/yangmei-a/showroom?batch=${draft.body.id}`)
assert.deepEqual(visitorBatch.body.goods.map((item) => item.code), ['A-001'])

const crossStall = await post('/api/demo/yangmei-b/batches', { title: '越权批次', goodsIds: [a1] },
  'integration-cross-stall-v1', { 'x-demo-staff': 'owner-b' })
assert.equal(crossStall.response.status, 400)

const currentA1 = (await request('/api/demo/yangmei-a/publishing', { headers: owner })).body.goods
  .find((item) => item.id === a1)
const competingWithdrawals = await Promise.all(['a', 'b'].map((candidate) =>
  request(`/api/demo/yangmei-a/goods/${a1}`, {
    method: 'PATCH', headers: { ...owner, 'content-type': 'application/json',
      'idempotency-key': `integration-withdraw-${currentA1.version}-${candidate}` },
    body: JSON.stringify({ status: 'withdrawn', version: currentA1.version }),
  })))
assert.deepEqual(competingWithdrawals.map((result) => result.response.status).sort(), [200, 409])
const withdrawn = competingWithdrawals.find((result) => result.response.status === 200)
const winningCandidate = competingWithdrawals.indexOf(withdrawn) === 0 ? 'a' : 'b'
assert.equal((await request('/api/demo/yangmei-a/showroom')).body.goods.some((item) => item.id === a1), false)
assert.equal((await fetch(`${base}/api/demo/yangmei-a/media/50000000-0000-4000-8000-000000000001`)).status, 404)
batchView = await request(`/api/demo/yangmei-a/showroom?customer=customer-multi&batch=${draft.body.id}`)
assert.deepEqual(batchView.body.goods.map((item) => item.code), ['A-002'])
const withdrawalRetry = await request(`/api/demo/yangmei-a/goods/${a1}`, {
  method: 'PATCH', headers: { ...owner, 'content-type': 'application/json',
    'idempotency-key': `integration-withdraw-${currentA1.version}-${winningCandidate}` },
  body: JSON.stringify({ status: 'withdrawn', version: currentA1.version }),
})
assert.equal(withdrawalRetry.body.version, withdrawn.body.version)
const restored = await request(`/api/demo/yangmei-a/goods/${a1}`, {
  method: 'PATCH', headers: { ...owner, 'content-type': 'application/json',
    'idempotency-key': `integration-restore-${withdrawn.body.version}` },
  body: JSON.stringify({ status: 'in_stock', version: withdrawn.body.version }),
})
assert.equal(restored.response.status, 200)
assert.equal(restored.body.status, 'in_stock')
assert.equal((await request('/api/demo/yangmei-a/showroom')).body.goods.some((item) => item.id === a1), true)
assert.equal((await fetch(`${base}/api/demo/yangmei-a/media/50000000-0000-4000-8000-000000000001`)).status, 200)
batchView = await request(`/api/demo/yangmei-a/showroom?customer=customer-multi&batch=${draft.body.id}`)
assert.deepEqual(batchView.body.goods.map((item) => item.code), ['A-001', 'A-002'])

const malformed = await fetch(`${base}/api/demo/yangmei-a/goods`, {
  method: 'POST', headers: { ...owner, 'content-type': 'application/json', 'idempotency-key': 'integration-malformed-v1' },
  body: '{',
})
assert.equal(malformed.status, 400)
const nonObject = await fetch(`${base}/api/demo/yangmei-a/goods`, {
  method: 'POST', headers: { ...owner, 'content-type': 'application/json', 'idempotency-key': 'integration-null-v1' },
  body: 'null',
})
assert.equal(nonObject.status, 400)

console.log('integration: all assertions passed')
