<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { API_BASE, loadShowroom, type GoodsCard } from '../../api'

const goods = ref<GoodsCard[]>([])
const modes = ['visitor', 'customer-multi', 'customer-grant', 'customer-list'] as const
const mode = ref<typeof modes[number]>('visitor')
const notice = ref('')
const stallName = ref('阳美一号档口')
const contactPhone = ref('')
const query = ref('')
const activeVideoIds = ref<string[]>([])
const batchId = ref('')
const batchTitle = ref('')
const modeLabels = ['访客', '多组客户', '单客授权客户', '无系数客户'] as const
const modeLabel = computed(() => modeLabels[modes.indexOf(mode.value)])
let refreshId = 0
const shown = computed(() => goods.value.filter((item) =>
  `${item.code}${item.name}${Object.values(item.attributes).join('')}${item.certificateSource ?? ''}`
    .includes(query.value.trim())))

async function refresh() {
  const current = ++refreshId
  goods.value = []
  activeVideoIds.value = []
  contactPhone.value = ''
  batchTitle.value = ''
  notice.value = ''
  try {
    const view = await loadShowroom(mode.value === 'visitor' ? '' : mode.value, batchId.value)
    if (current !== refreshId) return
    goods.value = view.goods
    stallName.value = view.stall.name
    contactPhone.value = view.stall.contact_phone ?? ''
    batchTitle.value = view.batch?.title ?? ''
    notice.value = mode.value !== 'visitor' && view.viewer?.recognized === false
      ? '当前测试客户未启用，正在展示访客公开商品' : ''
  } catch {
    if (current !== refreshId) return
    notice.value = batchId.value ? '批次当前不可访问，请联系老板' : '服务端暂不可用，无法显示当前商品和报价'
  }
}

function contact() {
  if (!contactPhone.value) return void uni.showToast({ title: '请稍后联系档口', icon: 'none' })
  uni.makePhoneCall({ phoneNumber: contactPhone.value })
}

function changeMode(event: { detail: { value: number } }) {
  mode.value = modes[event.detail.value]
  refresh()
}

function mediaUrl(id: string) {
  return `${API_BASE}/api/demo/yangmei-a/media/${id}${mode.value === 'visitor' ? '' : `?customer=${mode.value}`}`
}

function playVideo(id: string) {
  if (!activeVideoIds.value.includes(id)) activeVideoIds.value.push(id)
}

onLoad((options) => {
  batchId.value = typeof options?.batch === 'string' ? options.batch : ''
})
onShow(refresh)
</script>

<template>
  <view class="page">
    <view class="hero">
      <text class="eyebrow">{{ stallName }} · 合成数据</text>
      <text class="title">{{ batchTitle || '今天的新款，慢慢看' }}</text>
      <text class="sub">当前报价以刷新时为准，成交请联系老板确认。</text>
    </view>
    <view v-if="notice" class="notice">{{ notice }}</view>
    <picker :range="modeLabels" @change="changeMode">
      <view class="picker">开发测试身份：{{ modeLabel }}</view>
    </picker>
    <input v-model="query" class="search" placeholder="按货号、名称或属性筛选" />
    <view v-for="item in shown" :key="item.id" class="card">
      <template v-for="asset in item.media" :key="asset.id">
        <image v-if="asset.kind === 'image'" class="photo" mode="aspectFill" :src="mediaUrl(asset.id)" />
        <video v-else-if="activeVideoIds.includes(asset.id)" class="photo" controls autoplay :src="mediaUrl(asset.id)" />
        <view v-else class="photo video-placeholder"><button size="mini" @click="playVideo(asset.id)">播放视频</button></view>
      </template>
      <view class="row"><text class="code">{{ item.code }}</text><text>{{ item.name }}</text></view>
      <text class="details">{{ [item.attributes.shape, item.attributes.color].filter(Boolean).join(' · ') || '基础信息待补充' }}</text>
      <text v-if="item.certificateSource" class="details">证书来源：{{ item.certificateSource }}</text>
      <text class="price">{{ item.quote ? `¥${item.quote.priceYuan}` : '价格请询' }}</text>
      <button size="mini" @click="contact">联系老板</button>
    </view>
    <view v-if="!shown.length" class="empty">暂无可展示商品</view>
  </view>
</template>

<style scoped>
.page { padding: 28rpx; }.hero { padding: 36rpx; background: #173f31; color: white; border-radius: 28rpx; display: flex; flex-direction: column; gap: 14rpx; }.eyebrow,.sub { font-size: 24rpx; opacity: .74; }.title { font-size: 48rpx; font-weight: 700; }.notice { margin-top: 20rpx; padding: 18rpx; background: #fff2cf; border-radius: 12rpx; }.picker,.search { margin-top: 20rpx; padding: 24rpx; background: white; border-radius: 16rpx; }.card { margin-top: 24rpx; padding: 24rpx; background: white; border-radius: 24rpx; box-shadow: 0 10rpx 34rpx rgba(21,55,42,.08); }.photo { width: 100%; height: 360rpx; border-radius: 18rpx; background: #eaf0ec; }.video-placeholder { display: flex; align-items: center; justify-content: center; }.row { display: flex; gap: 20rpx; margin-top: 20rpx; font-size: 30rpx; }.code { color: #557468; }.details { display: block; margin-top: 10rpx; color: #6b8076; font-size: 24rpx; }.price { display: block; margin: 18rpx 0; color: #a14a27; font-size: 38rpx; font-weight: 700; }.empty { padding: 80rpx; text-align: center; color: #789086; }
</style>
