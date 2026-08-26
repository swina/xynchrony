<script setup lang="ts">
import { Piano, SlidersHorizontal } from '@lucide/vue'

defineProps<{ mode: 'performance' | 'soundDesign' }>()
const emit = defineEmits<{ change: [mode: 'performance' | 'soundDesign'] }>()
</script>

<template>
  <div class="inline-flex rounded-lg p-1 text-sm" style="border: 1px solid var(--color-mocha); background-color: var(--color-tan)">
    <button
      class="px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5"
      :class="mode === 'performance' ? 'sd-btn-primary' : ''"
      :style="mode === 'performance' ? {} : { color: 'var(--color-ink-soft)' }"
      @click="emit('change', 'performance')"
    >
      <Piano :size="14" /> Performance
    </button>
    <button
      class="px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5"
      :class="mode === 'soundDesign' ? 'sd-btn-primary' : ''"
      :style="mode === 'soundDesign' ? {} : { color: 'var(--color-ink-soft)' }"
      @click="emit('change', 'soundDesign')"
    >
      <SlidersHorizontal :size="14" /> Sound Design
    </button>
  </div>
</template>
