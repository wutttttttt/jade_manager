<script setup lang="ts">
import { ref, watch } from 'vue'
import { downloadMediaImage, removeTemporaryMedia } from '../platform/media'

const props = withDefaults(defineProps<{ src: string; height?: string }>(), { height: '360rpx' })
const path = ref('')
const failed = ref(false)

watch(() => props.src, (src, _, onCleanup) => {
  path.value = ''
  failed.value = false
  let cancelled = false
  let downloaded = ''
  onCleanup(() => {
    cancelled = true
    removeTemporaryMedia(downloaded)
  })
  if (!src) return
  // 先通过受控接口下载，再用本地路径展示，兼容局域网 HTTP 真机调试。
  downloadMediaImage(src).then((filePath) => {
    downloaded = filePath
    if (cancelled) return removeTemporaryMedia(filePath)
    path.value = filePath
  }).catch(() => {
    if (!cancelled) failed.value = true
  })
}, { immediate: true })
</script>

<template>
  <view class="media-image" :style="{ height: props.height }">
    <image v-if="path && !failed" class="image" mode="aspectFill" :src="path" @error="failed = true" />
    <view v-else class="feedback">{{ failed ? '图片加载失败，请刷新重试' : '图片加载中…' }}</view>
  </view>
</template>

<style scoped>
.media-image { width: 100%; overflow: hidden; border-radius: 18rpx; background: #eaf0ec; }
.image { width: 100%; height: 100%; }
.feedback { height: 100%; display: flex; align-items: center; justify-content: center; color: #567063; font-size: 24rpx; }
</style>
