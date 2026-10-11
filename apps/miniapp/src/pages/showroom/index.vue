<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MediaImage from '../../components/MediaImage.vue'
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
      <text class="eyebrow">档口看款 · 合成数据</text>
      <text class="title">{{ stallName }}</text>
      <text v-if="batchTitle" class="batch-title">{{ batchTitle }}</text>
      <text class="sub">当前报价以刷新时为准，成交请联系老板确认。</text>
    </view>
    <view v-if="notice" class="notice">{{ notice }}</view>
    <view class="filters">
      <text class="section-title">看款筛选</text>
      <input v-model="query" class="search" placeholder="按货号、名称或属性筛选" />
      <picker :range="modeLabels" @change="changeMode">
        <view class="picker"><text>开发测试身份</text><text>{{ modeLabel }} ›</text></view>
      </picker>
    </view>
    <view class="section-heading"><text class="section-title">{{ batchTitle ? '批次商品' : '在售商品' }}</text><text class="count">{{ shown.length }} 件</text></view>
    <view v-for="item in shown" :key="item.id" class="card">
      <view class="goods-info">
        <view class="row"><text class="goods-name">{{ item.name }}</text><text class="code">{{ item.code }}</text></view>
        <text class="details">{{ [item.attributes.shape, item.attributes.color].filter(Boolean).join(' · ') || '基础信息待补充' }}</text>
        <text v-if="item.certificateSource" class="details">证书来源：{{ item.certificateSource }}</text>
      </view>
      <view v-if="item.media.length" class="media-section">
        <view class="media-heading"><text>实拍图片 / 视频</text><text v-if="item.media.length > 1">左右滑动查看</text></view>
        <scroll-view class="media-strip" scroll-x>
          <view v-for="asset in item.media" :key="asset.id" class="media-item">
            <MediaImage v-if="asset.kind === 'image'" :src="mediaUrl(asset.id)" height="320rpx" />
            <video v-else-if="activeVideoIds.includes(asset.id)" class="photo" controls autoplay :src="mediaUrl(asset.id)" />
            <view v-else class="photo video-placeholder"><button size="mini" @click="playVideo(asset.id)">播放视频</button></view>
          </view>
        </scroll-view>
      </view>
      <view class="quote-row">
        <view><text class="quote-label">当前报价</text><text class="price">{{ item.quote ? `¥${item.quote.priceYuan}` : '价格请询' }}</text></view>
        <button class="contact-button" size="mini" @click="contact">联系老板</button>
      </view>
    </view>
    <view v-if="!shown.length" class="empty">暂无可展示商品</view>
  </view>
</template>

<style scoped>
.page { padding: 28rpx; }
.hero { padding: 32rpx; background: #173f31; color: white; border-radius: 24rpx; display: flex; flex-direction: column; gap: 12rpx; }
.eyebrow,.sub { font-size: 24rpx; opacity: .74; }
.title { font-size: 40rpx; font-weight: 700; }
.batch-title { font-size: 30rpx; }
.notice { margin-top: 20rpx; padding: 18rpx; background: #fff2cf; border-radius: 12rpx; }
.filters { margin-top: 24rpx; padding: 24rpx; background: white; border-radius: 20rpx; }
.section-title { font-size: 30rpx; font-weight: 700; color: #173f31; }
.search { margin-top: 20rpx; padding: 20rpx; background: #f1f5f2; border-radius: 12rpx; font-size: 26rpx; }
.picker { display: flex; justify-content: space-between; gap: 20rpx; margin-top: 20rpx; padding-top: 20rpx; border-top: 1rpx solid #eaf0ec; color: #6b8076; font-size: 24rpx; }
.section-heading { display: flex; justify-content: space-between; align-items: center; margin: 32rpx 4rpx 16rpx; }
.count { color: #6b8076; font-size: 24rpx; }
.card { margin-bottom: 24rpx; padding: 24rpx; background: white; border-radius: 20rpx; box-shadow: 0 10rpx 34rpx rgba(21,55,42,.06); }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 20rpx; }
.goods-name { font-size: 32rpx; font-weight: 700; color: #173f31; }
.code { flex-shrink: 0; color: #557468; font-size: 24rpx; }
.details { display: block; margin-top: 10rpx; color: #6b8076; font-size: 24rpx; }
.media-section { margin-top: 24rpx; }
.media-heading { display: flex; justify-content: space-between; gap: 16rpx; margin-bottom: 12rpx; color: #6b8076; font-size: 22rpx; }
.media-strip { width: 100%; white-space: nowrap; }
.media-item { display: inline-block; width: 520rpx; max-width: 100%; margin-right: 16rpx; vertical-align: top; white-space: normal; }
.media-item:last-child { margin-right: 0; }
.photo { width: 100%; height: 320rpx; border-radius: 18rpx; background: #eaf0ec; }
.video-placeholder { display: flex; align-items: center; justify-content: center; }
.quote-row { display: flex; justify-content: space-between; align-items: center; gap: 20rpx; margin-top: 24rpx; padding-top: 20rpx; border-top: 1rpx solid #eaf0ec; }
.quote-label { display: block; color: #6b8076; font-size: 22rpx; }
.price { display: block; margin-top: 6rpx; color: #a14a27; font-size: 36rpx; font-weight: 700; }
.contact-button { flex-shrink: 0; margin: 0; background: #173f31; color: white; }
.empty { padding: 80rpx; text-align: center; color: #789086; }
</style>
