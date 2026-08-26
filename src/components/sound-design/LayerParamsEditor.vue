<script setup lang="ts">
// Non-envelope/LFO/mod-matrix/filter layer params: delay, transpose, fine
// tune, non-transpose flag, volume, pan. Filter type/cutoff/resonance live
// in FilterPanel.vue (Filter tab) -- see docs/plans/sound-design-ui.md.
// Dial `learnId`s are stable roles ("sd:layer:...") rather than per-layer,
// so a physical MIDI knob learned here keeps controlling "whichever layer
// is selected", matching hardware MIDI Learn semantics -- see
// useMidiLearn.ts.
import { computed } from 'vue'
import { useUserBanks } from '../../composables/useUserBanks'
import Dial from './Dial.vue'

const { activePreset, activeLayerIndex } = useUserBanks()

const layer = computed(() => {
  if (!activePreset.value || activeLayerIndex.value === null) return null
  return activePreset.value.layers[activeLayerIndex.value] ?? null
})

const fmtMs = (v: number) => `${Math.round(v)}ms`
const fmtSemi = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}st`
const fmtCents = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}c`
const fmtDb = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}dB`
const fmtPan = (v: number) => (v === 0 ? 'C' : v < 0 ? `L${Math.abs(Math.round(v))}` : `R${Math.round(v)}`)
</script>

<template>
  <div v-if="layer" class="sd-panel flex flex-col gap-3 w-72 shrink-0">
    <h3 class="sd-panel-title">Layer {{ activeLayerIndex }} &middot; Params</h3>

    <div class="flex flex-wrap gap-3 justify-center">
      <Dial v-model="layer.params.delayMs" :min="0" :max="10000" :step="10" label="Delay" learn-id="sd:layer:delay" :format-value="fmtMs" />
      <Dial v-model="layer.params.transposeSemitones" :min="-64" :max="64" label="Transpose" learn-id="sd:layer:transpose" :format-value="fmtSemi" />
      <Dial v-model="layer.params.fineTuneCents" :min="-100" :max="100" label="Fine tune" learn-id="sd:layer:finetune" :format-value="fmtCents" />
      <Dial v-model="layer.params.volumeDb" :min="-96" :max="12" label="Volume" learn-id="sd:layer:volume" :format-value="fmtDb" />
      <Dial v-model="layer.params.pan" :min="-64" :max="63" label="Pan" learn-id="sd:layer:pan" :format-value="fmtPan" />
    </div>

    <label class="flex items-center gap-2 text-xs justify-center">
      <input v-model="layer.params.nonTranspose" type="checkbox" />
      Non-transpose (pitch fixed)
    </label>
  </div>
</template>
