<script setup lang="ts">
// Key/velocity range, root key, fine tune, per-zone volume/pan for the
// selected zone, plus a "Change sample" action. Loop start/end/isLooping
// shown read-only -- derived from the assigned sample's own WAV data
// (RIFF 'smpl' chunk, read by tools/build_bank.py), not independently
// editable. See approved plan Part 2 / M9. Dial `learnId`s are stable
// roles (sd:zone:...) -- see LayerParamsEditor.vue for why. Key range is
// assigned via the ZoneRangeKeyboard mini keyboard by default (see
// docs/plans/sound-design-ui.md); the Lo/Hi key dials are hidden behind a
// toggle, same "drawing mode first, dials behind a button" pattern as
// EnvelopeEditor.vue.
import { ref, computed } from 'vue'
import { useUserBanks } from '../../composables/useUserBanks'
import SamplePickerModal from './SamplePickerModal.vue'
import ZoneRangeKeyboard from './ZoneRangeKeyboard.vue'
import Dial from './Dial.vue'
import { AudioWaveform, SlidersHorizontal } from '@lucide/vue'

const { activePreset, activeLayerIndex, activeZoneIndex } = useUserBanks()

const layer = computed(() => {
  if (!activePreset.value || activeLayerIndex.value === null) return null
  return activePreset.value.layers[activeLayerIndex.value] ?? null
})

const zone = computed(() => {
  if (!layer.value || activeZoneIndex.value === null) return null
  return layer.value.zones[activeZoneIndex.value] ?? null
})

const showRangeDials = ref(false)

const showPicker = ref(false)

function handlePick(entry: { sampleName: string; wavFile: string; sampleRate: number | null }) {
  showPicker.value = false
  if (!zone.value) return
  zone.value.sampleName = entry.sampleName
  zone.value.wavFile = entry.wavFile
  zone.value.sampleRate = entry.sampleRate
  // New sample's own loop data isn't known here (that lives in the Orbit-3
  // bank's zone records, not indexed by sample name alone) -- reset to
  // "no loop" rather than keep a stale value from whatever was assigned
  // before. Deliberate simplification: correct loop metadata for a
  // reassigned sample is a follow-up, not silently wrong data.
  zone.value.loopStart = 0
  zone.value.loopEnd = 0
  zone.value.isLooping = false
}

const fmtKey = (v: number) => String(Math.round(v))
const fmtCents64 = (v: number) => String(Math.round(v))
</script>

<template>
  <div v-if="zone" class="sd-panel flex flex-col gap-3 w-72 shrink-0">
    <div class="flex items-center justify-between">
      <h3 class="sd-panel-title">Zone {{ activeZoneIndex }}</h3>
      <button class="sd-btn inline-flex items-center gap-1" @click="showPicker = true"><AudioWaveform :size="14" /> Change sample&hellip;</button>
    </div>
    <div class="text-sm truncate">{{ zone.sampleName ?? '(no sample assigned)' }}</div>

    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between">
        <div class="text-xs" style="color: var(--color-ink-soft)">Key range: {{ zone.loKey }}&ndash;{{ zone.hiKey }}</div>
        <button class="sd-btn sd-btn-icon" :title="showRangeDials ? 'Hide dials' : 'Show dials'" @click="showRangeDials = !showRangeDials">
          <SlidersHorizontal :size="14" />
        </button>
      </div>
      <ZoneRangeKeyboard v-if="layer" :zones="layer.zones" :active-zone-index="activeZoneIndex" />
      <div v-if="showRangeDials" class="flex flex-wrap gap-3 justify-center pt-2">
        <Dial v-model="zone.loKey" :min="0" :max="127" label="Lo key" learn-id="sd:zone:lokey" :format-value="fmtKey" />
        <Dial v-model="zone.hiKey" :min="0" :max="127" label="Hi key" learn-id="sd:zone:hikey" :format-value="fmtKey" />
      </div>
    </div>

    <div class="flex flex-wrap gap-3 justify-center">
      <Dial v-model="zone.rootKey" :min="0" :max="127" label="Root key" learn-id="sd:zone:rootkey" :format-value="fmtKey" />
      <Dial v-model="zone.loVel" :min="0" :max="127" label="Lo vel" learn-id="sd:zone:lovel" :format-value="fmtKey" />
      <Dial v-model="zone.hiVel" :min="0" :max="127" label="Hi vel" learn-id="sd:zone:hivel" :format-value="fmtKey" />
      <Dial v-model="zone.fineTune" :min="-8192" :max="8191" :step="10" label="Fine tune" learn-id="sd:zone:finetune" :format-value="fmtCents64" />
    </div>

    <div class="grid grid-cols-2 gap-3 text-xs">
      <label class="flex flex-col gap-1">
        Volume (dB, blank = use layer's)
        <input v-model.number="zone.volumeDb" type="number" min="-96" max="12" class="sd-input" />
      </label>
      <label class="flex flex-col gap-1">
        Pan (blank = use layer's)
        <input v-model.number="zone.pan" type="number" min="-64" max="63" class="sd-input" />
      </label>
    </div>

    <div class="text-xs border-t pt-2" style="color: var(--color-ink-soft); border-color: var(--color-mocha)">
      Loop: <span v-if="zone.isLooping">{{ zone.loopStart }}&ndash;{{ zone.loopEnd }} (from sample data)</span><span v-else>none</span>
    </div>

    <SamplePickerModal v-if="showPicker" @pick="handlePick" @close="showPicker = false" />
  </div>
</template>
