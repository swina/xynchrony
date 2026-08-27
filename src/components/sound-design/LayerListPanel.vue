<script setup lang="ts">
// Layers within the selected preset: add (blank defaults), duplicate,
// remove, reorder. Mutates activePreset.layers directly (same reactive
// array the live-audition engine reads) -- SoundDesignView's debounced
// watcher persists it. See approved plan Part 2 / M9.
import { computed } from 'vue'
import { useUserBanks } from '../../composables/useUserBanks'
import { blankLayer } from '../../core/soundDesign/defaults'
import { deepClonePlain } from '../../utils/deepClone'
import { Plus, ChevronUp, ChevronDown, Copy, X } from '@lucide/vue'

const { activePreset, activeLayerIndex } = useUserBanks()

const layers = computed(() => activePreset.value?.layers ?? [])

function renumber() {
  layers.value.forEach((l, i) => { l.layerIndex = i })
}

function handleAdd() {
  if (!activePreset.value) return
  activePreset.value.layers.push(blankLayer(activePreset.value.layers.length))
  activeLayerIndex.value = activePreset.value.layers.length - 1
}

function handleDuplicate(index: number) {
  if (!activePreset.value) return
  const clone = deepClonePlain(activePreset.value.layers[index])
  activePreset.value.layers.splice(index + 1, 0, clone)
  renumber()
  activeLayerIndex.value = index + 1
}

function handleRemove(index: number) {
  if (!activePreset.value) return
  if (!confirm('Remove this layer?')) return
  activePreset.value.layers.splice(index, 1)
  renumber()
  if (activeLayerIndex.value === index) activeLayerIndex.value = null
  else if (activeLayerIndex.value !== null && activeLayerIndex.value > index) activeLayerIndex.value--
}

function handleMove(index: number, delta: number) {
  if (!activePreset.value) return
  const target = index + delta
  if (target < 0 || target >= activePreset.value.layers.length) return
  const layers = activePreset.value.layers
  ;[layers[index], layers[target]] = [layers[target], layers[index]]
  renumber()
  if (activeLayerIndex.value === index) activeLayerIndex.value = target
  else if (activeLayerIndex.value === target) activeLayerIndex.value = index
}
</script>

<template>
  <div v-if="activePreset" class="sd-panel flex flex-col gap-2 w-64 shrink-0">
    <div class="flex items-center justify-between">
      <h3 class="sd-panel-title">Layers</h3>
      <button class="sd-btn inline-flex items-center gap-1" @click="handleAdd"><Plus :size="14" /> Add</button>
    </div>

    <div class="rounded-lg border sd-divide max-h-64 overflow-y-auto sd-scroll" style="border-color: var(--color-mocha)">
      <div
        v-for="(layer, i) in layers"
        :key="i"
        class="sd-row flex items-center justify-between gap-2 px-3 py-2 cursor-pointer"
        :class="i === activeLayerIndex ? 'sd-row-active' : ''"
        @click="activeLayerIndex = i"
      >
        <div class="text-sm">Layer {{ i }} &middot; {{ layer.zones.length }} zone(s)</div>
        <div class="flex gap-1 shrink-0">
          <button class="sd-btn sd-btn-icon" title="Move up" :disabled="i === 0" @click.stop="handleMove(i, -1)"><ChevronUp :size="14" /></button>
          <button class="sd-btn sd-btn-icon" title="Move down" :disabled="i === layers.length - 1" @click.stop="handleMove(i, 1)"><ChevronDown :size="14" /></button>
          <button class="sd-btn sd-btn-icon" title="Duplicate" @click.stop="handleDuplicate(i)"><Copy :size="14" /></button>
          <button class="sd-btn sd-btn-icon sd-btn-danger" title="Remove" @click.stop="handleRemove(i)"><X :size="14" /></button>
        </div>
      </div>
      <div v-if="layers.length === 0" class="px-3 py-4 text-sm text-center" style="color: var(--color-ink-soft)">
        No layers yet.
      </div>
    </div>
  </div>
</template>
