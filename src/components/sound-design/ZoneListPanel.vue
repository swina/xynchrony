<script setup lang="ts">
// Zones within the selected layer: add (via the sample picker -- a zone
// needs a sample to mean anything), remove, select. See approved plan
// Part 2 / M9.
import { ref, computed } from 'vue'
import { useUserBanks } from '../../composables/useUserBanks'
import { blankZone } from '../../core/soundDesign/defaults'
import SamplePickerModal from './SamplePickerModal.vue'
import { Plus, X } from '@lucide/vue'

const { activePreset, activeLayerIndex, activeZoneIndex } = useUserBanks()

const layer = computed(() => {
  if (!activePreset.value || activeLayerIndex.value === null) return null
  return activePreset.value.layers[activeLayerIndex.value] ?? null
})

const showPicker = ref(false)

function handlePick(entry: { sampleName: string; wavFile: string; sampleRate: number | null }) {
  showPicker.value = false
  if (!layer.value) return
  const zone = blankZone()
  zone.sampleName = entry.sampleName
  zone.wavFile = entry.wavFile
  zone.sampleRate = entry.sampleRate
  layer.value.zones.push(zone)
  activeZoneIndex.value = layer.value.zones.length - 1
}

function handleRemove(index: number) {
  if (!layer.value) return
  if (!confirm('Remove this zone?')) return
  layer.value.zones.splice(index, 1)
  if (activeZoneIndex.value === index) activeZoneIndex.value = null
  else if (activeZoneIndex.value !== null && activeZoneIndex.value > index) activeZoneIndex.value--
}
</script>

<template>
  <div v-if="layer" class="sd-panel flex flex-col gap-2 w-64 shrink-0">
    <div class="flex items-center justify-between">
      <h3 class="sd-panel-title">Zones (Layer {{ activeLayerIndex }})</h3>
      <button class="sd-btn inline-flex items-center gap-1" @click="showPicker = true"><Plus :size="14" /> Add</button>
    </div>

    <div class="rounded-lg border sd-divide max-h-64 overflow-y-auto sd-scroll" style="border-color: var(--color-mocha)">
      <div
        v-for="(zone, i) in layer.zones"
        :key="i"
        class="sd-row flex items-center justify-between gap-2 px-3 py-2 cursor-pointer"
        :class="i === activeZoneIndex ? 'sd-row-active' : ''"
        @click="activeZoneIndex = i"
      >
        <div class="min-w-0">
          <div class="truncate text-sm">{{ zone.sampleName ?? '(no sample)' }}</div>
          <div class="text-xs" style="color: var(--color-ink-soft)">key[{{ zone.loKey }}-{{ zone.hiKey }}] root={{ zone.rootKey }}</div>
        </div>
        <button class="sd-btn sd-btn-icon sd-btn-danger shrink-0" title="Remove" @click.stop="handleRemove(i)"><X :size="14" /></button>
      </div>
      <div v-if="layer.zones.length === 0" class="px-3 py-4 text-sm text-center" style="color: var(--color-ink-soft)">
        No zones yet.
      </div>
    </div>

    <SamplePickerModal v-if="showPicker" @pick="handlePick" @close="showPicker = false" />
  </div>
</template>
