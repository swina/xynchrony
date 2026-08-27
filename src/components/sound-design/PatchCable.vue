<script setup lang="ts">
// One bezier cable between two jack points on a patch canvas -- shared by
// FxChainEditor.vue (free-form FX graph) and ModulationEditor.vue (fixed
// source/destination jack panel). See docs/plans/FX-Modulations.md's
// "Visual patch editor". A wide invisible stroke widens the click target
// without widening what's drawn; `pointer-events: stroke` on both paths
// (set via the parent SVG being `pointer-events: none` otherwise) is what
// lets clicks pass through empty canvas space to the nodes/jacks below.
import { computed } from 'vue'

const props = defineProps<{ x1: number; y1: number; x2: number; y2: number; active?: boolean; color?: string }>()
const emit = defineEmits<{ click: [] }>()

const path = computed(() => {
  const dx = Math.max(40, Math.abs(props.x2 - props.x1) / 2)
  return `M ${props.x1} ${props.y1} C ${props.x1 + dx} ${props.y1}, ${props.x2 - dx} ${props.y2}, ${props.x2} ${props.y2}`
})
</script>

<template>
  <g>
    <path :d="path" fill="none" stroke="transparent" stroke-width="14" style="pointer-events: stroke; cursor: pointer" @click="emit('click')" />
    <path
      :d="path" fill="none"
      :stroke="active ? 'var(--color-primary-dark)' : (color ?? 'var(--color-mocha)')"
      stroke-width="3"
      style="pointer-events: stroke; cursor: pointer"
      @click="emit('click')"
    />
  </g>
</template>
