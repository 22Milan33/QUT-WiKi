<script setup lang="ts">
defineProps<{
  name: string
  link: string
  avatar?: string
  siteshot?: string
  desc?: string
}>()

function hideBroken(event: Event) {
  const img = event.currentTarget as HTMLImageElement
  img.style.display = 'none'
}
</script>

<template>
  <a class="qut-flink" :href="link" target="_blank" rel="noopener noreferrer">
    <div class="qut-flink-img">
      <img
        v-if="siteshot"
        :src="siteshot"
        :alt="name"
        loading="lazy"
        @error="hideBroken"
      >
    </div>
    <div class="qut-flink-info">
      <img
        v-if="avatar"
        class="qut-flink-avatar"
        :src="avatar"
        :alt="name"
        loading="lazy"
        @error="hideBroken"
      >
      <span class="qut-flink-title">{{ name }}</span>
      <span v-if="desc" class="qut-flink-desc">{{ desc }}</span>
    </div>
  </a>
</template>

<style scoped>
.qut-flink {
  display: inline-block;
  width: calc(25% - 16px);
  margin: 8px;
  vertical-align: top;
  line-height: 1.4;
  color: inherit;
  text-decoration: none;
}

@media (max-width: 768px) {
  .qut-flink {
    width: calc(33.333% - 16px);
  }
}

@media (max-width: 500px) {
  .qut-flink {
    width: calc(50% - 16px);
  }
}

.qut-flink-img {
  width: 100%;
  aspect-ratio: 7 / 5;
  overflow: hidden;
  border-radius: 6px;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.2);
  background: var(--vp-c-bg-soft);
  transition: box-shadow 0.28s ease;
}

.qut-flink:hover .qut-flink-img {
  box-shadow: 0 4px 8px 0 rgba(0, 0, 0, 0.1), 0 8px 16px 0 rgba(0, 0, 0, 0.1);
}

.qut-flink-img img {
  width: 100%;
  height: 100%;
  pointer-events: none;
  object-fit: cover;
  transition: transform 2s ease;
}

.qut-flink:hover .qut-flink-img img {
  transform: scale(1.08);
}

.qut-flink-info {
  margin-top: 8px;
}

.qut-flink-avatar {
  float: left;
  width: 32px;
  height: 32px;
  margin: 2px 8px 8px 0;
  border-radius: 16px;
  pointer-events: none;
  background: var(--vp-c-bg-soft);
}

.qut-flink-info span {
  display: block;
}

.qut-flink-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  transition: color 0.28s ease;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.qut-flink:hover .qut-flink-title {
  color: var(--vp-c-brand-1);
}

.qut-flink-desc {
  min-height: 2.4em;
  font-size: 16px;
  line-height: 1.2;
  color: var(--vp-c-text-2);
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
