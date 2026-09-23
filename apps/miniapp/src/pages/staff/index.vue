<script setup lang="ts">
import { reactive, ref } from 'vue'
import { onLoad, onShareAppMessage, onShow } from '@dcloudio/uni-app'
import { createAssistant, createAudienceGroup, createBatchDraft, createGoods, loadCustomers, loadPricing, loadPublishing,
  loadStaff, publishBatch, reviewMedia, saveCustomer, saveCustomerOverride, saveGoodsAudience, saveGoodsPrices,
  saveGoodsStatus, saveStaffAccess, uploadMedia, API_BASE, type Batch, type CustomerSettings, type CustomerWorkspace, type PricingGoods,
  type PublishingGoods, type StaffMember } from '../../api'
import { captureGoodsMedia, clearDraft, detectMediaMimeType, loadDraft, readLocalMedia, removeLocalMedia, saveDraft,
  type LocalMedia } from '../../platform/media'

const form = reactive({ code: '', name: '', shape: '', color: '', certificateSource: '',
  listPriceCents: 20000, costPriceCents: 10000,
  floorPriceCents: 12000, publicVisible: false, publicPriceVisible: false })
const media = ref<LocalMedia[]>([])
const message = ref('开发测试身份：owner-a')
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
    await refreshPublishing()
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

function mediaState(item: PublishingGoods) {
  return item.media.map((asset) => asset.status).join('、') || '无'
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
    <view class="head"><text class="title">快速录货</text><text class="hint">{{ message }}</text></view>
    <view class="form">
      <input v-model="form.code" placeholder="货号，例如 A-004" @input="persistGoodsDraft" />
      <input v-model="form.name" placeholder="商品名称" @input="persistGoodsDraft" />
      <input v-model="form.shape" placeholder="器型，例如 平安扣" @input="persistGoodsDraft" />
      <input v-model="form.color" placeholder="颜色，例如 晴水" @input="persistGoodsDraft" />
      <input v-model="form.certificateSource" placeholder="证书来源（可选）" @input="persistGoodsDraft" />
      <input v-model.number="form.listPriceCents" type="number" placeholder="挂牌价（分）" @input="persistGoodsDraft" />
      <input v-model.number="form.costPriceCents" type="number" placeholder="成本价（分）" @input="persistGoodsDraft" />
      <input v-model.number="form.floorPriceCents" type="number" placeholder="最低可售价（分）" @input="persistGoodsDraft" />
      <label><switch :checked="form.publicVisible" @change="toggle('publicVisible', $event)" /> 无门槛可见</label>
      <label><switch :checked="form.publicPriceVisible" @change="toggle('publicPriceVisible', $event)" /> 访客显示挂牌价</label>
      <button @click="chooseMedia">拍照或录视频（{{ media.length }}）</button>
      <button type="primary" @click="submit">保存货品</button>
      <button v-if="form.code || form.name || form.shape || form.color || form.certificateSource || media.length"
        @click="discardGoodsDraft">清空本机草稿</button>
    </view>
    <view class="section">
      <text class="section-title">三项价格</text>
      <view v-for="goods in pricingGoods" :key="goods.id" class="customer-card">
        <text>{{ goods.code }} · {{ goods.name }} · v{{ goods.version }}</text>
        <input v-model.number="goods.listPriceCents" type="number" placeholder="挂牌价（分）" @input="pricesChanged(goods)" />
        <input v-model.number="goods.costPriceCents" type="number" placeholder="成本价（分）" @input="pricesChanged(goods)" />
        <input v-model.number="goods.floorPriceCents" type="number" placeholder="最低可售价（分）" @input="pricesChanged(goods)" />
        <button size="mini" @click="storePrices(goods)">保存价格</button>
      </view>
    </view>
    <view class="section">
      <text class="section-title">批次发布</text>
      <input v-model="batchTitle" placeholder="批次名称" />
      <checkbox-group @change="selectGoods">
        <label v-for="item in publishingGoods" :key="item.id" class="goods-option">
          <checkbox :value="item.id" :checked="selectedGoodsIds.includes(item.id)" :disabled="item.status !== 'in_stock'" />
          <text>{{ item.code }} · {{ item.name }}</text>
          <text class="hint">{{ [item.attributes.shape, item.attributes.color, item.certificateSource].filter(Boolean).join(' · ') || '未填基础属性' }}</text>
          <button v-if="item.status === 'in_stock'" size="mini" @click.prevent="changeGoodsStatus(item, 'withdrawn')">撤销可见性</button>
          <button v-else size="mini" @click.prevent="changeGoodsStatus(item, 'in_stock')">恢复在库</button>
          <text class="media-state">媒体：{{ mediaState(item) }}</text>
          <view v-for="asset in item.media" :key="asset.id" class="media-actions">
            <image v-if="asset.kind === 'image'" class="review-media" mode="aspectFill" :src="reviewMediaUrl(asset.id)" />
            <video v-else-if="activeReviewVideoIds.includes(asset.id)" class="review-media" controls autoplay
              :src="reviewMediaUrl(asset.id)" />
            <view v-else class="review-media video-placeholder">
              <button size="mini" @click.prevent="playReviewVideo(asset.id)">播放审核视频</button>
            </view>
            <text>{{ asset.kind }} · {{ asset.status }} · v{{ asset.version }}</text>
            <view>
              <button size="mini" @click.prevent="review(asset, 'approved')">通过</button>
              <button size="mini" @click.prevent="review(asset, 'rejected')">驳回</button>
              <button size="mini" @click.prevent="review(asset, 'withdrawn')">撤回</button>
            </view>
          </view>
        </label>
      </checkbox-group>
      <button @click="saveBatch">保存批次草稿</button>
      <view v-for="batch in batches" :key="batch.id" class="batch">
        <view><text>{{ batch.title }}</text><text class="badge">{{ batch.status }}</text></view>
        <text class="hint">{{ batch.goodsIds.length }} 件 · v{{ batch.version }}</text>
        <button v-if="batch.status === 'draft'" size="mini" type="primary" @click="publish(batch)">审核通过后发布</button>
        <button v-else-if="batch.status === 'published'" size="mini" open-type="share"
          :data-batch-id="batch.id">转发看款批次</button>
      </view>
    </view>
    <view class="section">
      <text class="section-title">客户可见性与定价</text>
      <text class="hint">商品组和单客授权只决定看什么；系数只决定价格。</text>
      <view class="override-row">
        <input v-model="newGroupName" placeholder="新商品组名称" />
        <button size="mini" @click="addGroup">创建组</button>
      </view>
      <view v-for="goods in customerGoods" :key="goods.id" class="customer-card">
        <text>{{ goods.code }} · {{ goods.name }} · v{{ goods.version }}</text>
        <label><switch :checked="goods.publicVisible" @change="toggleGoodsAudience(goods, 'publicVisible', $event)" /> 无门槛可见</label>
        <label><switch :checked="goods.publicPriceVisible" @change="toggleGoodsAudience(goods, 'publicPriceVisible', $event)" /> 访客显示挂牌价</label>
        <checkbox-group @change="selectGoodsGroups(goods, $event)">
          <label v-for="group in customerGroups" :key="group.id" class="inline-option">
            <checkbox :value="group.id" :checked="goods.groupIds.includes(group.id)" />{{ group.name }}
          </label>
        </checkbox-group>
        <button size="mini" @click="storeGoodsAudience(goods)">保存商品可见范围</button>
      </view>
      <view v-for="customer in customers" :key="customer.id" class="customer-card">
        <text>{{ customer.name }} · {{ customer.code }} · v{{ customer.version }}</text>
        <label><switch :checked="customer.active" @change="toggleCustomer(customer, $event)" /> 允许专属看款</label>
        <input v-model="customer.coefficientBps" type="number" placeholder="价格系数（基点，8000 = 0.8；留空用挂牌价）" @input="customerChanged(customer)" />
        <text class="media-state">可见商品组</text>
        <checkbox-group @change="selectCustomerGroups(customer, $event)">
          <label v-for="group in customerGroups" :key="group.id" class="inline-option">
            <checkbox :value="group.id" :checked="customer.groupIds.includes(group.id)" />{{ group.name }}
          </label>
        </checkbox-group>
        <text class="media-state">单客补充授权</text>
        <checkbox-group @change="selectCustomerGoods(customer, $event)">
          <label v-for="goods in customerGoods" :key="goods.id" class="inline-option">
            <checkbox :value="goods.id" :checked="customer.grantedGoodsIds.includes(goods.id)" />{{ goods.code }}
          </label>
        </checkbox-group>
        <button size="mini" type="primary" @click="storeCustomer(customer)">保存客户设置</button>
        <text class="media-state">单客商品价（分，留空清除）</text>
        <view v-for="goods in customerGoods" :key="goods.id" class="override-row">
          <text>{{ goods.code }}</text>
          <input type="number" :value="overrideDrafts[overrideKey(customer.id, goods.id)] ?? ''"
            placeholder="无修正价" @input="overrideChanged(customer, goods.id, $event)" />
          <button size="mini" @click="storeOverride(customer, goods.id)">保存</button>
        </view>
      </view>
    </view>
    <view class="section">
      <text class="section-title">员工权限</text>
      <text class="hint">老板不可被停用；伙计只获得勾选的固定能力。</text>
      <view class="override-row">
        <input v-model="assistantForm.code" placeholder="员工编号" />
        <input v-model="assistantForm.name" placeholder="员工姓名" />
        <button size="mini" @click="addAssistant">新增</button>
      </view>
      <view v-for="staff in staffMembers" :key="staff.id" class="customer-card">
        <text>{{ staff.name }} · {{ staff.code }} · {{ staff.role }} · v{{ staff.version }}</text>
        <template v-if="staff.role === 'assistant'">
          <label><switch :checked="staff.active" @change="toggleStaff(staff, $event)" /> 启用</label>
          <checkbox-group @change="selectStaffPermissions(staff, $event)">
            <label v-for="permission in availablePermissions" :key="permission" class="inline-option">
              <checkbox :value="permission" :checked="staff.permissions.includes(permission)" />{{ permissionLabel(permission) }}
            </label>
          </checkbox-group>
          <button size="mini" @click="storeStaff(staff)">保存员工权限</button>
        </template>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 28rpx; }.head { padding: 32rpx; background: #dcece2; border-radius: 24rpx; }.title { display: block; font-size: 44rpx; font-weight: 700; }.hint { display: block; margin-top: 12rpx; color: #567063; }.form,.section { margin-top: 24rpx; display: flex; flex-direction: column; gap: 20rpx; }.form input,.form label,.section input { padding: 24rpx; background: white; border-radius: 16rpx; }.section { padding-top: 24rpx; border-top: 2rpx solid #d9e3dd; }.section-title { font-size: 36rpx; font-weight: 700; }.goods-option,.batch { display: flex; flex-direction: column; gap: 10rpx; margin-top: 14rpx; padding: 22rpx; background: white; border-radius: 16rpx; }.media-state,.badge { color: #6b8076; font-size: 24rpx; }.badge { margin-left: 16rpx; }
.media-actions { padding-top: 10rpx; border-top: 1rpx solid #e3ebe6; }.media-actions view { display: flex; gap: 8rpx; margin-top: 8rpx; }.media-actions button { margin: 0; }
.review-media { width: 100%; height: 280rpx; border-radius: 12rpx; background: #eaf0ec; }
.video-placeholder { display: flex; align-items: center; justify-content: center; }
.customer-card { display: flex; flex-direction: column; gap: 14rpx; padding: 22rpx; background: white; border-radius: 16rpx; }.inline-option { display: inline-flex; align-items: center; margin: 8rpx 18rpx 8rpx 0; }
.override-row { display: flex; align-items: center; gap: 10rpx; }.override-row text { width: 130rpx; }.override-row input { flex: 1; min-width: 0; }.override-row button { margin: 0; }
</style>
