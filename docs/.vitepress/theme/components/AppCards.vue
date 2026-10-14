<script setup lang="ts">
export interface AppCardItem {
  text?: string
  icon?: string
  desc?: string
  link?: string
}

withDefaults(defineProps<{
  links: AppCardItem[]
  width?: string
  textLines?: number
  descLines?: number | false
}>(), {
  width: '12em',
  textLines: 2,
  descLines: false,
})

function safeLink(value?: string) {
  if (!value) return undefined
  if (/^(\/|\.\/|\.\.\/|#)/.test(value)) return value.startsWith('//') ? undefined : value
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined
  } catch {
    return undefined
  }
}

function isExternal(value?: string) {
  return safeLink(value)?.startsWith('http') ?? false
}
</script>

<template>
  <div class="app-cards" :style="{ '--col-width': width }">
    <component
      :is="safeLink(item.link) ? 'a' : 'span'"
      v-for="(item, index) in links"
      :key="index"
      class="link card"
      :href="safeLink(item.link)"
      :target="isExternal(item.link) ? '_blank' : undefined"
      :rel="isExternal(item.link) ? 'noopener noreferrer' : undefined"
    >
      <img v-if="item.icon?.startsWith('http')" class="icon" :src="item.icon" alt="">
      <span v-if="item.text || item.desc" class="body">
        <span class="text-ellipsis content" :style="{ '--lines': textLines }">{{ item.text }}</span>
        <span
          v-if="item.desc"
          class="text-ellipsis link-desc"
          :style="descLines ? { '--lines': descLines } : undefined"
        >{{ item.desc }}</span>
      </span>
    </component>
  </div>
</template>

<style scoped>
.app-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--col-width, 12em), 1fr));
  gap: 0.8em;
  margin: 1em 0;
}

.app-cards .link.card {
  display: flex;
  align-items: center;
  gap: 0.7em;
  margin: 0;
  padding: 0.6em 0.8em;
  border: 1px solid transparent;
  border-radius: 0.5em;
  background-color: var(--vp-c-bg-soft);
  color: inherit;
  line-height: 1.4;
  text-decoration: none;
  transition: all 0.2s;
}

.app-cards a.link.card:hover {
  border-color: var(--vp-c-brand-1);
  background-color: var(--vp-c-bg);
  color: var(--vp-c-brand-1);
}

.app-cards .icon {
  flex-shrink: 0;
  width: 2.2em;
  height: 2.2em;
  margin: 0;
  border-radius: 0.45em;
  object-fit: contain;
}

.app-cards .body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.app-cards .content {
  font-weight: 500;
}

.app-cards .link-desc {
  opacity: 0.8;
  margin-top: 0.2em;
  font-size: 0.8em;
}

.app-cards .text-ellipsis {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: var(--lines);
  line-clamp: var(--lines);
  -webkit-box-orient: vertical;
}
</style>
