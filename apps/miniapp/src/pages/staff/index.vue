<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad, onShareAppMessage, onShow } from '@dcloudio/uni-app'
import MediaImage from '../../components/MediaImage.vue'
import { createAssistant, createAudienceGroup, createBatchDraft, createGoods, loadCustomers, loadPricing, loadPublishing,
  loadStaff, publishBatch, reviewMedia, saveCustomer, saveCustomerOverride, saveGoodsAudience, saveGoodsPrices,
  saveGoodsStatus, saveStaffAccess, uploadMedia, API_BASE, type Batch, type CustomerSettings, type CustomerWorkspace, type PricingGoods,
  type PublishingGoods, type StaffMember } from '../../api'
import { captureGoodsMedia, clearDraft, detectMediaMimeType, loadDraft, readLocalMedia, removeLocalMedia, saveDraft,
  type LocalMedia } from '../../platform/media'
import { scanGoodsCode } from '../../platform/scan'

const form = reactive({ code: '', name: '', shape: '', color: '', certificateSource: '',
  listPriceCents: 20000, costPriceCents: 10000,
  floorPriceCents: 12000, publicVisible: false, publicPriceVisible: false })
const media = ref<LocalMedia[]>([])
const scanning = ref(false)
const message = ref('开发测试身份：老板（合成数据）')
const goodsRequestId = ref(`goods-${Date.now()}`)
const batchTitle = ref(`新款 ${new Date().toISOString().slice(0, 10)}`)
const batchRequestId = ref(`batch-draft-${Date.now()}`)
const selectedGoodsIds = ref<string[]>([])
const publishingGoods = ref<PublishingGoods[]>([])
const batches = ref<Batch[]>([])
const customers = ref<CustomerSettings[]>([])
const customerGroups = ref<CustomerWorkspace['groups']>([])
const customerGoods = ref<CustomerWorkspace['goods']>([])
const overrideDrafts = reactive<Record<string, string>>({})
const overrideRequestIds = reactive<Record<string, string>>({})
const newGroupName = ref('')
const groupRequestId = ref(`audience-group-${Date.now()}`)
const staffMembers = ref<StaffMember[]>([])
const availablePermissions = ref<string[]>([])
const assistantForm = reactive({ code: '', name: '' })
const assistantRequestId = ref(`staff-create-${Date.now()}`)
const pricingGoods = ref<PricingGoods[]>([])
const activeReviewVideoIds = ref<string[]>([])
const sections = [
  { id: 'capture', title: '录货', description: '拍照、填写货档、保存草稿' },
  { id: 'goods', title: '货品管理', description: '价格、可见范围、在库状态' },
  { id: 'review', title: '媒体审核', description: '查看图片视频、通过或驳回' },
  { id: 'batches', title: '批次发布', description: '选货、发布、转发与历史' },
  { id: 'customers', title: '客户管理', description: '商品组、客户授权与报价' },
  { id: 'staff', title: '员工权限', description: '新增伙计、授权与停用' },
] as const
type Section = 'home' | typeof sections[number]['id']
const activeSection = ref<Section>('home')
const sectionTitle = computed(() => sections.find((item) => item.id === activeSection.value)?.title ?? '档口工作台')
const goodsTab = ref<'prices' | 'audience'>('prices')
const goodsQuery = ref('')
const expandedGoodsId = ref('')
const expandedReviewGoodsId = ref('')
const expandedCustomerId = ref('')
const filteredGoods = computed(() => publishingGoods.value.filter((goods) =>
  `${goods.code} ${goods.name}`.toLowerCase().includes(goodsQuery.value.trim().toLowerCase())))
const reviewGoods = computed(() => filteredGoods.value.filter((goods) => goods.media.length))
const pendingMediaCount = computed(() => publishingGoods.value.reduce((total, goods) =>
  total + goods.media.filter((asset) => asset.status === 'pending').length, 0))

function openSection(section: Section) {
  activeSection.value = section
  message.value = '开发测试身份：老板（合成数据）'
  activeReviewVideoIds.value = []
  goodsQuery.value = ''
  uni.pageScrollTo({ scrollTop: 0, duration: 0 })
}

function toggleReviewGoods(id: string) {
  expandedReviewGoodsId.value = expandedReviewGoodsId.value === id ? '' : id
  activeReviewVideoIds.value = []
}

function statusLabel(status: string) {
  return ({ pending: '待审核', approved: '已通过', rejected: '已驳回', withdrawn: '已撤回',
    in_stock: '在库', draft: '草稿', published: '已发布' } as Record<string, string>)[status] ?? status
}

function toggle(field: 'publicVisible' | 'publicPriceVisible', event: { detail: { value: boolean } }) {
  form[field] = event.detail.value
  persistGoodsDraft()
}

function persistGoodsDraft() {
  try {
    saveDraft({ form: { ...form }, media: media.value, requestId: goodsRequestId.value })
    return true
  } catch {
    message.value = '本机草稿保存失败，请清理小程序存储后重试'
    return false
  }
}

async function scanCode() {
  if (scanning.value) return
  scanning.value = true
  try {
    const code = await scanGoodsCode()
    if (code === null) return
    const previous = form.code
    form.code = code
    if (!persistGoodsDraft()) {
      form.code = previous
      return
    }
    message.value = '已扫描录入货号，可继续修改或填写货品信息'
  } catch (error) {
    message.value = error instanceof Error ? error.message : '扫描失败，请重试或手动输入货号'
  } finally {
    scanning.value = false
  }
}

async function chooseMedia() {
  try {
    const next = await captureGoodsMedia()
    const previous = media.value
    media.value = next
    if (!persistGoodsDraft()) {
      media.value = previous
      removeLocalMedia(next)
      return
    }
    removeLocalMedia(previous)
    message.value = `已持久保存 ${next.length} 个待上传素材`
  } catch (error) {
    message.value = error instanceof Error ? error.message : '选择媒体失败，原草稿已保留'
  }
}

async function submit() {
  if (!form.code.trim() || !form.name.trim()) return void (message.value = '请填写货号和名称')
  try {
    const goods = await createGoods(form, goodsRequestId.value)
    for (const item of media.value) {
      const data = await readLocalMedia(item.path)
      await uploadMedia(goods.id, { ...item, mimeType: detectMediaMimeType(data, item.kind), data })
    }
    clearDraft(media.value)
    Object.assign(form, { code: '', name: '', shape: '', color: '', certificateSource: '' })
    goodsRequestId.value = `goods-${Date.now()}`
    media.value = []
    message.value = '货品与媒体已保存，媒体等待审核'
    await Promise.all([refreshPublishing(), refreshCustomers(), refreshPricing()])
  } catch (error) {
    const saved = persistGoodsDraft()
    message.value = `${error instanceof Error ? error.message : '保存失败'}；${saved ? '草稿已留在本机' : '本机草稿保存失败'}`
  }
}

function discardGoodsDraft() {
  clearDraft(media.value)
  media.value = []
  Object.assign(form, { code: '', name: '', shape: '', color: '', certificateSource: '',
    listPriceCents: 20000, costPriceCents: 10000,
    floorPriceCents: 12000, publicVisible: false, publicPriceVisible: false })
  goodsRequestId.value = `goods-${Date.now()}`
  message.value = '本机录货草稿已清空'
}

async function review(asset: PublishingGoods['media'][number], status: 'approved' | 'rejected' | 'withdrawn') {
  try {
    await reviewMedia(asset, status)
    message.value = '媒体审核状态已更新'
    await refreshPublishing()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '媒体审核失败'
  }
}

async function changeGoodsStatus(goods: PublishingGoods, status: 'in_stock' | 'withdrawn') {
  try {
    await saveGoodsStatus(goods, status)
    message.value = status === 'withdrawn' ? '货品已撤销，旧入口刷新后立即隐藏' : '货品已恢复在库'
    await Promise.all([refreshPublishing(), refreshCustomers()])
  } catch (error) {
    message.value = error instanceof Error ? error.message : '更新货品状态失败'
  }
}

async function refreshPublishing() {
  try {
    const workspace = await loadPublishing()
    publishingGoods.value = workspace.goods
    batches.value = workspace.batches
    selectedGoodsIds.value = selectedGoodsIds.value.filter((id) =>
      workspace.goods.some((goods) => goods.id === id && goods.status === 'in_stock'))
  } catch (error) {
    message.value = error instanceof Error ? error.message : '加载批次失败'
  }
}

async function refreshCustomers() {
  try {
    const workspace = await loadCustomers()
    customers.value = workspace.customers
    customerGroups.value = workspace.groups
    customerGoods.value = workspace.goods
    for (const key of Object.keys(overrideDrafts)) delete overrideDrafts[key]
    for (const key of Object.keys(overrideRequestIds)) delete overrideRequestIds[key]
    for (const customer of workspace.customers) for (const override of customer.overrides) {
      overrideDrafts[`${customer.id}:${override.goodsId}`] = String(override.priceCents)
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : '加载客户失败'
  }
}

async function refreshStaff() {
  try {
    const workspace = await loadStaff()
    staffMembers.value = workspace.staff
    availablePermissions.value = workspace.permissions
  } catch (error) {
    message.value = error instanceof Error ? error.message : '加载员工失败'
  }
}

async function refreshPricing() {
  try {
    pricingGoods.value = await loadPricing()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '加载价格失败'
  }
}

function pricesChanged(goods: PricingGoods) {
  goods.requestId = `goods-prices-${goods.id}-${goods.version}-${Date.now()}`
}

async function storePrices(goods: PricingGoods) {
  try {
    if (!goods.requestId) pricesChanged(goods)
    await saveGoodsPrices(goods)
    message.value = '三项价格已更新，客户后续刷新即时生效'
    await refreshPricing()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '保存价格失败'
  }
}

function permissionLabel(permission: string) {
  return ({ 'goods.edit': '货品编辑', 'media.publish': '媒体/发布', 'customer.manage': '客户/可见性',
    'price.list.edit': '挂牌价', 'price.cost.edit': '成本价', 'price.floor.edit': '最低价' } as Record<string, string>)[permission] ?? permission
}

function staffChanged(staff: StaffMember) {
  staff.requestId = `staff-access-${staff.id}-${staff.version}-${Date.now()}`
}

function selectStaffPermissions(staff: StaffMember, event: { detail: { value: string[] } }) {
  staff.permissions = event.detail.value
  staffChanged(staff)
}

function toggleStaff(staff: StaffMember, event: { detail: { value: boolean } }) {
  staff.active = event.detail.value
  staffChanged(staff)
}

async function storeStaff(staff: StaffMember) {
  try {
    if (!staff.requestId) staffChanged(staff)
    await saveStaffAccess(staff)
    message.value = '员工权限已更新'
    await refreshStaff()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '保存员工权限失败'
  }
}

async function addAssistant() {
  if (!assistantForm.code.trim() || !assistantForm.name.trim()) return void (message.value = '请填写员工编号和姓名')
  try {
    await createAssistant(assistantForm.code, assistantForm.name, assistantRequestId.value)
    assistantForm.code = ''
    assistantForm.name = ''
    assistantRequestId.value = `staff-create-${Date.now()}`
    message.value = '员工已新增，默认没有任何权限'
    await refreshStaff()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '新增员工失败'
  }
}

function customerChanged(customer: CustomerSettings) {
  customer.requestId = `customer-${customer.id}-${customer.version}-${Date.now()}`
}

function toggleCustomer(customer: CustomerSettings, event: { detail: { value: boolean } }) {
  customer.active = event.detail.value
  customerChanged(customer)
}

function selectCustomerGroups(customer: CustomerSettings, event: { detail: { value: string[] } }) {
  customer.groupIds = event.detail.value
  customerChanged(customer)
}

function selectCustomerGoods(customer: CustomerSettings, event: { detail: { value: string[] } }) {
  customer.grantedGoodsIds = event.detail.value
  customerChanged(customer)
}

async function storeCustomer(customer: CustomerSettings) {
  try {
    if (!customer.requestId) customerChanged(customer)
    await saveCustomer(customer)
    message.value = '客户可见范围与价格系数已独立生效'
    await Promise.all([refreshCustomers(), refreshPublishing()])
  } catch (error) {
    message.value = error instanceof Error ? error.message : '保存客户失败'
  }
}

function goodsAudienceChanged(goods: CustomerWorkspace['goods'][number]) {
  goods.requestId = `goods-audience-${goods.id}-${goods.version}-${Date.now()}`
}

function toggleGoodsAudience(goods: CustomerWorkspace['goods'][number],
  field: 'publicVisible' | 'publicPriceVisible', event: { detail: { value: boolean } }) {
  goods[field] = event.detail.value
  goodsAudienceChanged(goods)
}

function selectGoodsGroups(goods: CustomerWorkspace['goods'][number], event: { detail: { value: string[] } }) {
  goods.groupIds = event.detail.value
  goodsAudienceChanged(goods)
}

async function storeGoodsAudience(goods: CustomerWorkspace['goods'][number]) {
  try {
    if (!goods.requestId) goodsAudienceChanged(goods)
    await saveGoodsAudience(goods)
    message.value = '商品可见范围已更新，客户价格规则未改变'
    await Promise.all([refreshCustomers(), refreshPublishing()])
  } catch (error) {
    message.value = error instanceof Error ? error.message : '保存商品可见范围失败'
  }
}

function overrideKey(customerId: string, goodsId: string) {
  return `${customerId}:${goodsId}`
}

function overrideChanged(customer: CustomerSettings, goodsId: string, event: { detail: { value: string } }) {
  const key = overrideKey(customer.id, goodsId)
  overrideDrafts[key] = event.detail.value
  overrideRequestIds[key] = `customer-override-${customer.id}-${goodsId}-${customer.version}-${Date.now()}`
}

async function storeOverride(customer: CustomerSettings, goodsId: string) {
  const key = overrideKey(customer.id, goodsId)
  try {
    overrideRequestIds[key] ||= `customer-override-${customer.id}-${goodsId}-${customer.version}-${Date.now()}`
    await saveCustomerOverride(customer, goodsId, overrideDrafts[key] ?? '', overrideRequestIds[key])
    message.value = '单客商品价已更新；最低可售价仍由服务端兜底'
    await refreshCustomers()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '保存单客商品价失败'
  }
}

async function addGroup() {
  if (!newGroupName.value.trim()) return void (message.value = '请填写商品组名称')
  try {
    await createAudienceGroup(newGroupName.value, groupRequestId.value)
    newGroupName.value = ''
    groupRequestId.value = `audience-group-${Date.now()}`
    message.value = '商品组已创建'
    await refreshCustomers()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '创建商品组失败'
  }
}

function selectGoods(event: { detail: { value: string[] } }) {
  selectedGoodsIds.value = event.detail.value
}

async function saveBatch() {
  if (!selectedGoodsIds.value.length) return void (message.value = '请先选择货品')
  try {
    await createBatchDraft(batchTitle.value, selectedGoodsIds.value, batchRequestId.value)
    selectedGoodsIds.value = []
    batchRequestId.value = `batch-draft-${Date.now()}`
    message.value = '批次草稿已保存'
    await refreshPublishing()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '批次保存失败'
  }
}

async function publish(batch: Batch) {
  try {
    await publishBatch(batch)
    message.value = '批次已发布'
    await refreshPublishing()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '发布失败'
  }
}

function reviewMediaUrl(id: string) {
  return `${API_BASE}/api/demo/yangmei-a/media/${id}/review-file?staff=owner-a`
}

function playReviewVideo(id: string) {
  if (!activeReviewVideoIds.value.includes(id)) activeReviewVideoIds.value.push(id)
}

onLoad(() => {
  const draft = loadDraft<{ form?: Partial<typeof form>; media?: LocalMedia[]; requestId?: string }>()
  if (!draft) return
  Object.assign(form, draft.form)
  media.value = draft.media ?? []
  goodsRequestId.value = draft.requestId ?? goodsRequestId.value
  message.value = '已恢复本机录货草稿'
})

onShow(() => Promise.all([refreshPublishing(), refreshCustomers(), refreshStaff(), refreshPricing()]))
onShareAppMessage((event) => {
  const batchId = String((event.target as { dataset?: { batchId?: string } } | undefined)?.dataset?.batchId ?? '')
  const batch = batches.value.find((item) => item.id === batchId)
  return { title: batch?.title ?? '翡翠档口看款', path: `/pages/showroom/index${batchId ? `?batch=${batchId}` : ''}` }
})
</script>

<template>
  <view class="page">
    <view class="page-head">
      <button v-if="activeSection !== 'home'" class="back-button" size="mini" @click="openSection('home')">‹ 工作台</button>
      <view><text class="eyebrow">商家工作台</text><text class="title">{{ sectionTitle }}</text></view>
      <text v-if="activeSection === 'home'" class="head-note">按功能进入，集中处理一件事</text>
    </view>
    <view class="notice"><text>{{ message }}</text></view>

    <template v-if="activeSection === 'home'">
      <view class="overview">
        <view><text class="overview-number">{{ publishingGoods.length }}</text><text>货品</text></view>
        <view><text class="overview-number">{{ pendingMediaCount }}</text><text>待审媒体</text></view>
        <view><text class="overview-number">{{ batches.filter((batch) => batch.status === 'published').length }}</text><text>已发布批次</text></view>
      </view>
      <view class="entry-grid">
        <button v-for="(section, index) in sections" :key="section.id" class="entry-card" @click="openSection(section.id)">
          <text class="entry-number">0{{ index + 1 }}</text>
          <text class="entry-title">{{ section.title }}</text>
          <text class="entry-description">{{ section.description }}</text>
          <text class="entry-arrow">进入 ›</text>
        </button>
      </view>
    </template>

    <view v-else-if="activeSection === 'capture'" class="panel-stack">
      <view class="panel form">
        <text class="section-title">货品信息</text>
        <label class="field"><text>货号</text><input v-model="form.code" placeholder="例如 A-004" @input="persistGoodsDraft" /></label>
        <button :disabled="scanning" :loading="scanning" @click="scanCode">扫描条形码</button>
        <label class="field"><text>商品名称</text><input v-model="form.name" placeholder="填写商品名称" @input="persistGoodsDraft" /></label>
        <label class="field"><text>器型</text><input v-model="form.shape" placeholder="例如平安扣" @input="persistGoodsDraft" /></label>
        <label class="field"><text>颜色</text><input v-model="form.color" placeholder="例如晴水" @input="persistGoodsDraft" /></label>
        <label class="field"><text>证书来源（选填）</text><input v-model="form.certificateSource" placeholder="填写证书来源" @input="persistGoodsDraft" /></label>
      </view>
      <view class="panel form">
        <text class="section-title">价格</text><text class="hint">金额单位为分，100 分 = 1 元</text>
        <label class="field"><text>挂牌价（分）</text><input v-model.number="form.listPriceCents" type="number" @input="persistGoodsDraft" /></label>
        <label class="field"><text>成本价（分）</text><input v-model.number="form.costPriceCents" type="number" @input="persistGoodsDraft" /></label>
        <label class="field"><text>最低可售价（分）</text><input v-model.number="form.floorPriceCents" type="number" @input="persistGoodsDraft" /></label>
      </view>
      <view class="panel form">
        <text class="section-title">公开设置</text>
        <label class="switch-row"><text>无门槛可见</text><switch :checked="form.publicVisible" @change="toggle('publicVisible', $event)" /></label>
        <label class="switch-row"><text>访客显示挂牌价</text><switch :checked="form.publicPriceVisible" @change="toggle('publicPriceVisible', $event)" /></label>
      </view>
      <view class="panel form">
        <text class="section-title">图片与视频</text><text class="hint">已选 {{ media.length }} 个素材，保存后到媒体审核中处理</text>
        <scroll-view v-if="media.length" scroll-x class="draft-media">
          <view class="draft-media-strip">
            <view v-for="item in media" :key="item.requestId" class="draft-preview">
              <image v-if="item.kind === 'image'" :src="item.path" mode="aspectFill" />
              <view v-else class="draft-video">视频素材</view>
            </view>
          </view>
        </scroll-view>
        <button @click="chooseMedia">拍照或选择图片 / 视频</button>
      </view>
      <view class="actions">
        <button type="primary" @click="submit">保存货品</button>
        <button v-if="form.code || form.name || form.shape || form.color || form.certificateSource || media.length" @click="discardGoodsDraft">清空本机草稿</button>
      </view>
    </view>

    <view v-else-if="activeSection === 'goods'" class="panel-stack">
      <view class="segmented">
        <button :class="{ active: goodsTab === 'prices' }" @click="goodsTab = 'prices'">价格管理</button>
        <button :class="{ active: goodsTab === 'audience' }" @click="goodsTab = 'audience'">可见范围</button>
      </view>
      <input v-model="goodsQuery" class="search" placeholder="搜索货号或商品名称" />
      <text class="hint">点开一件货品查看和编辑</text>
      <view v-for="item in filteredGoods" :key="item.id" class="panel">
        <view class="card-heading">
          <view><text class="card-title">{{ item.code }} · {{ item.name }}</text><text class="hint">{{ item.status === 'in_stock' ? '在库' : '已撤销可见性' }}</text></view>
          <button size="mini" @click="expandedGoodsId = expandedGoodsId === item.id ? '' : item.id">{{ expandedGoodsId === item.id ? '收起' : '编辑' }}</button>
        </view>
        <view v-if="expandedGoodsId === item.id" class="card-body">
          <text class="hint">{{ [item.attributes.shape, item.attributes.color, item.certificateSource].filter(Boolean).join(' · ') || '未填基础属性' }}</text>
          <template v-if="goodsTab === 'prices'">
            <view v-for="goods in pricingGoods.filter((goods) => goods.id === item.id)" :key="goods.id" class="form">
              <text class="hint">金额单位为分，100 分 = 1 元</text>
              <label class="field"><text>挂牌价（分）</text><input v-model.number="goods.listPriceCents" type="number" @input="pricesChanged(goods)" /></label>
              <label class="field"><text>成本价（分）</text><input v-model.number="goods.costPriceCents" type="number" @input="pricesChanged(goods)" /></label>
              <label class="field"><text>最低可售价（分）</text><input v-model.number="goods.floorPriceCents" type="number" @input="pricesChanged(goods)" /></label>
              <button type="primary" @click="storePrices(goods)">保存价格</button>
            </view>
          </template>
          <template v-else>
            <view v-for="goods in customerGoods.filter((goods) => goods.id === item.id)" :key="goods.id" class="form">
              <label class="switch-row"><text>无门槛可见</text><switch :checked="goods.publicVisible" @change="toggleGoodsAudience(goods, 'publicVisible', $event)" /></label>
              <label class="switch-row"><text>访客显示挂牌价</text><switch :checked="goods.publicPriceVisible" @change="toggleGoodsAudience(goods, 'publicPriceVisible', $event)" /></label>
              <text class="field-label">可见商品组</text>
              <checkbox-group @change="selectGoodsGroups(goods, $event)">
                <label v-for="group in customerGroups" :key="group.id" class="choice"><checkbox :value="group.id" :checked="goods.groupIds.includes(group.id)" />{{ group.name }}</label>
              </checkbox-group>
              <button type="primary" @click="storeGoodsAudience(goods)">保存可见范围</button>
            </view>
          </template>
          <view class="state-action">
            <button v-if="item.status === 'in_stock'" @click="changeGoodsStatus(item, 'withdrawn')">撤销可见性</button>
            <button v-else @click="changeGoodsStatus(item, 'in_stock')">恢复在库</button>
          </view>
        </view>
      </view>
      <view v-if="!filteredGoods.length" class="empty">暂无匹配货品</view>
    </view>

    <view v-else-if="activeSection === 'review'" class="panel-stack">
      <input v-model="goodsQuery" class="search" placeholder="搜索待审核的货号或名称" />
      <text class="hint">点开货品查看媒体；待审、驳回和撤回的媒体不会向客户展示</text>
      <view v-for="item in reviewGoods" :key="item.id" class="panel">
        <view class="card-heading">
          <view><text class="card-title">{{ item.code }} · {{ item.name }}</text><text class="hint">{{ item.media.length }} 个媒体 · {{ item.media.filter((asset) => asset.status === 'pending').length }} 个待审</text></view>
          <button size="mini" @click="toggleReviewGoods(item.id)">{{ expandedReviewGoodsId === item.id ? '收起' : '查看' }}</button>
        </view>
        <view v-if="expandedReviewGoodsId === item.id" class="card-body media-list">
          <view v-for="asset in item.media" :key="asset.id" class="media-card">
            <MediaImage v-if="asset.kind === 'image'" height="280rpx" :src="reviewMediaUrl(asset.id)" />
            <video v-else-if="activeReviewVideoIds.includes(asset.id)" class="review-media" controls autoplay :src="reviewMediaUrl(asset.id)" />
            <view v-else class="review-media video-placeholder"><button size="mini" @click="playReviewVideo(asset.id)">播放审核视频</button></view>
            <view class="media-caption"><text>{{ asset.kind === 'image' ? '图片' : '视频' }}</text><text class="badge">{{ statusLabel(asset.status) }}</text></view>
            <view class="review-actions">
              <button size="mini" type="primary" @click="review(asset, 'approved')">通过</button>
              <button size="mini" @click="review(asset, 'rejected')">驳回</button>
              <button size="mini" @click="review(asset, 'withdrawn')">撤回</button>
            </view>
          </view>
        </view>
      </view>
      <view v-if="!reviewGoods.length" class="empty">暂无匹配的媒体货品</view>
    </view>

    <view v-else-if="activeSection === 'batches'" class="panel-stack">
      <view class="panel form">
        <text class="section-title">创建批次</text>
        <label class="field"><text>批次名称</text><input v-model="batchTitle" placeholder="填写批次名称" /></label>
        <text class="hint">已选 {{ selectedGoodsIds.length }} 件；发布前请在媒体审核中通过所选货品的全部媒体</text>
        <checkbox-group @change="selectGoods">
          <label v-for="item in publishingGoods" :key="item.id" class="goods-choice">
            <checkbox :value="item.id" :checked="selectedGoodsIds.includes(item.id)" :disabled="item.status !== 'in_stock'" />
            <view><text>{{ item.code }} · {{ item.name }}</text><text class="hint">{{ item.status === 'in_stock' ? '在库' : '已撤销' }} · {{ !item.media.length ? '未上传媒体' : item.media.every((asset) => asset.status === 'approved') ? '媒体已全部通过' : '媒体未全部通过' }}</text></view>
          </label>
        </checkbox-group>
        <button type="primary" @click="saveBatch">保存批次草稿</button>
      </view>
      <view class="section-heading"><text class="section-title">批次历史</text><text class="hint">{{ batches.length }} 个批次</text></view>
      <view v-for="batch in batches" :key="batch.id" class="panel form">
        <view class="card-heading"><text class="card-title">{{ batch.title }}</text><text class="badge">{{ statusLabel(batch.status) }}</text></view>
        <text class="hint">{{ batch.goodsIds.length }} 件货品</text>
        <button v-if="batch.status === 'draft'" type="primary" @click="publish(batch)">发布批次</button>
        <button v-else-if="batch.status === 'published'" open-type="share" :data-batch-id="batch.id">转发看款批次</button>
      </view>
      <view v-if="!batches.length" class="empty">暂无历史批次</view>
    </view>

    <view v-else-if="activeSection === 'customers'" class="panel-stack">
      <view class="panel form">
        <text class="section-title">商品组</text>
        <text class="hint">商品组决定客户能看哪些货品</text>
        <view class="inline-form"><input v-model="newGroupName" placeholder="新商品组名称" /><button size="mini" @click="addGroup">创建组</button></view>
        <view class="group-list"><text v-for="group in customerGroups" :key="group.id" class="group-tag">{{ group.name }}</text></view>
      </view>
      <view class="section-heading"><text class="section-title">客户设置</text><text class="hint">点开客户配置授权和报价</text></view>
      <view v-for="customer in customers" :key="customer.id" class="panel">
        <view class="card-heading">
          <view><text class="card-title">{{ customer.name }}</text><text class="hint">{{ customer.active ? '专属看款已启用' : '专属看款已停用' }} · {{ customer.groupIds.length }} 个商品组</text></view>
          <button size="mini" @click="expandedCustomerId = expandedCustomerId === customer.id ? '' : customer.id">{{ expandedCustomerId === customer.id ? '收起' : '设置' }}</button>
        </view>
        <view v-if="expandedCustomerId === customer.id" class="card-body form">
          <text class="hint">客户编号：{{ customer.code }}</text>
          <label class="switch-row"><text>允许专属看款</text><switch :checked="customer.active" @change="toggleCustomer(customer, $event)" /></label>
          <label class="field"><text>价格系数</text><input v-model="customer.coefficientBps" type="number" placeholder="留空使用挂牌价" @input="customerChanged(customer)" /></label>
          <text class="hint">8000 表示 0.8 倍；系数只改变报价，不授予商品可见权限</text>
          <text class="field-label">可见商品组</text>
          <checkbox-group @change="selectCustomerGroups(customer, $event)">
            <label v-for="group in customerGroups" :key="group.id" class="choice"><checkbox :value="group.id" :checked="customer.groupIds.includes(group.id)" />{{ group.name }}</label>
          </checkbox-group>
          <text class="field-label">单客补充授权</text>
          <checkbox-group @change="selectCustomerGoods(customer, $event)">
            <label v-for="goods in customerGoods" :key="goods.id" class="choice"><checkbox :value="goods.id" :checked="customer.grantedGoodsIds.includes(goods.id)" />{{ goods.code }} · {{ goods.name }}</label>
          </checkbox-group>
          <button type="primary" @click="storeCustomer(customer)">保存客户设置</button>
          <view class="subsection">
            <text class="field-label">单客商品价</text><text class="hint">金额单位为分；留空保存可清除修正价</text>
            <view v-for="goods in customerGoods" :key="goods.id" class="override-row">
              <text>{{ goods.code }}</text>
              <input type="number" :value="overrideDrafts[overrideKey(customer.id, goods.id)] ?? ''" placeholder="无修正价" @input="overrideChanged(customer, goods.id, $event)" />
              <button size="mini" @click="storeOverride(customer, goods.id)">保存</button>
            </view>
          </view>
        </view>
      </view>
      <view v-if="!customers.length" class="empty">暂无客户</view>
    </view>

    <view v-else-if="activeSection === 'staff'" class="panel-stack">
      <view class="panel form">
        <text class="section-title">新增伙计</text>
        <label class="field"><text>员工编号</text><input v-model="assistantForm.code" placeholder="填写员工编号" /></label>
        <label class="field"><text>员工姓名</text><input v-model="assistantForm.name" placeholder="填写员工姓名" /></label>
        <text class="hint">新增伙计默认没有权限，请在下方单独授权</text><button type="primary" @click="addAssistant">新增伙计</button>
      </view>
      <view class="section-heading"><text class="section-title">员工与权限</text><text class="hint">老板不可被停用</text></view>
      <view v-for="staff in staffMembers" :key="staff.id" class="panel form">
        <view class="card-heading"><text class="card-title">{{ staff.name }}</text><text class="badge">{{ staff.role === 'owner' ? '老板' : '伙计' }}</text></view>
        <text class="hint">员工编号：{{ staff.code }}</text>
        <template v-if="staff.role === 'assistant'">
          <label class="switch-row"><text>启用员工</text><switch :checked="staff.active" @change="toggleStaff(staff, $event)" /></label>
          <checkbox-group @change="selectStaffPermissions(staff, $event)">
            <label v-for="permission in availablePermissions" :key="permission" class="choice"><checkbox :value="permission" :checked="staff.permissions.includes(permission)" />{{ permissionLabel(permission) }}</label>
          </checkbox-group>
          <button @click="storeStaff(staff)">保存员工权限</button>
        </template>
        <text v-else class="hint">老板拥有档口管理权限</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 28rpx 28rpx 60rpx; }
.page-head { padding: 32rpx; background: #173f31; color: white; border-radius: 24rpx; }
.eyebrow { display: block; font-size: 22rpx; opacity: .7; margin-bottom: 10rpx; }
.title { display: block; font-size: 44rpx; font-weight: 700; }
.head-note { display: block; font-size: 24rpx; margin-top: 12rpx; opacity: .8; }
.back-button { margin: 0 0 22rpx; padding: 0 20rpx; background: #edf5f0; color: #173f31; }
.notice { margin: 20rpx 0; padding: 18rpx 22rpx; background: #e6efe9; border-radius: 14rpx; font-size: 24rpx; color: #466553; }
.overview { display: flex; justify-content: space-around; padding: 22rpx 0 32rpx; }
.overview view { display: flex; flex-direction: column; align-items: center; gap: 6rpx; font-size: 24rpx; color: #6b8076; }
.overview-number { font-size: 44rpx; font-weight: 700; color: #173f31; }
.entry-grid { display: flex; flex-wrap: wrap; gap: 20rpx; }
.entry-card { box-sizing: border-box; width: calc((100% - 20rpx) / 2); margin: 0; padding: 26rpx; background: white; text-align: left; line-height: 1.5; border-radius: 22rpx; }
.entry-card::after { border: none; }
.entry-number { display: block; font-size: 22rpx; color: #86a493; }
.entry-title { display: block; font-size: 32rpx; font-weight: 700; color: #173f31; margin: 12rpx 0; }
.entry-description { display: block; min-height: 68rpx; font-size: 24rpx; color: #6b8076; }
.entry-arrow { display: block; margin-top: 20rpx; color: #217451; font-size: 24rpx; }
.panel-stack { display: flex; flex-direction: column; gap: 22rpx; }
.panel { padding: 26rpx; background: white; border-radius: 22rpx; }
.form { display: flex; flex-direction: column; gap: 18rpx; }
.section-title { display: block; font-size: 32rpx; font-weight: 700; }
.hint { display: block; margin-top: 6rpx; color: #6b8076; font-size: 24rpx; line-height: 1.6; }
.field { display: flex; flex-direction: column; gap: 12rpx; font-size: 26rpx; }
input { box-sizing: border-box; min-height: 82rpx; padding: 18rpx 20rpx; background: #f5f7f5; border-radius: 12rpx; font-size: 28rpx; }
.search { background: white; }
.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16rpx; font-size: 28rpx; padding: 10rpx 0; }
.actions { display: flex; flex-direction: column; gap: 16rpx; }
.form button,.actions button,.state-action button { width: 100%; }
button[type=primary] { background: #217451; }
.segmented { display: flex; padding: 8rpx; background: #e6efe9; border-radius: 18rpx; gap: 8rpx; }
.segmented button { flex: 1; margin: 0; border-radius: 12rpx; font-size: 28rpx; background: transparent; color: #6b8076; }
.segmented button::after { border: none; }
.segmented button.active { background: white; color: #173f31; font-weight: 700; }
.card-heading { display: flex; justify-content: space-between; align-items: center; gap: 16rpx; }
.card-heading > view { flex: 1; min-width: 0; }
.card-heading button { flex-shrink: 0; margin: 0; color: #217451; background: #edf5f0; }
.card-title { display: block; font-size: 30rpx; font-weight: 600; line-height: 1.5; overflow-wrap: break-word; }
.card-body { margin-top: 22rpx; padding-top: 22rpx; border-top: 1rpx solid #e3ebe6; }
.state-action,.subsection { margin-top: 20rpx; padding-top: 20rpx; border-top: 1rpx solid #e3ebe6; }
.field-label { display: block; font-size: 28rpx; font-weight: 600; }
.choice { display: flex; align-items: center; gap: 10rpx; padding: 14rpx 0; font-size: 26rpx; }
.badge { padding: 6rpx 14rpx; border-radius: 10rpx; background: #edf5f0; color: #466553; font-size: 24rpx; flex-shrink: 0; }
.media-list { display: flex; flex-direction: column; gap: 28rpx; }
.media-card { padding-bottom: 20rpx; border-bottom: 1rpx solid #e3ebe6; }
.media-card:last-child { padding-bottom: 0; border-bottom: none; }
.media-caption { display: flex; justify-content: space-between; align-items: center; margin: 16rpx 0; font-size: 26rpx; }
.review-actions { display: flex; gap: 12rpx; }
.review-actions button { flex: 1; margin: 0; }
.review-media { width: 100%; height: 280rpx; border-radius: 12rpx; background: #eaf0ec; }
.video-placeholder { display: flex; align-items: center; justify-content: center; }
.goods-choice { display: flex; align-items: center; gap: 12rpx; padding: 18rpx 0; border-bottom: 1rpx solid #edf1ee; font-size: 28rpx; }
.section-heading { padding: 8rpx 4rpx; }
.inline-form { display: flex; gap: 12rpx; align-items: center; }
.inline-form input { flex: 1; min-width: 0; }
.inline-form button { width: auto; margin: 0; flex-shrink: 0; }
.group-list { display: flex; flex-wrap: wrap; gap: 12rpx; }
.group-tag { padding: 10rpx 16rpx; background: #edf5f0; border-radius: 10rpx; font-size: 24rpx; color: #466553; }
.override-row { display: flex; align-items: center; gap: 12rpx; margin-top: 16rpx; }
.override-row > text { width: 140rpx; flex-shrink: 0; font-size: 24rpx; overflow-wrap: break-word; }
.override-row input { flex: 1; min-width: 0; }
.override-row button { width: auto; margin: 0; flex-shrink: 0; }
.draft-media { width: 100%; white-space: nowrap; }
.draft-media-strip { display: flex; gap: 14rpx; }
.draft-preview { width: 160rpx; height: 160rpx; flex-shrink: 0; border-radius: 12rpx; overflow: hidden; }
.draft-preview image { width: 100%; height: 100%; }
.draft-video { height: 100%; display: flex; align-items: center; justify-content: center; background: #eaf0ec; color: #567063; font-size: 24rpx; }
.empty { padding: 60rpx 20rpx; text-align: center; color: #789086; font-size: 28rpx; }
</style>
