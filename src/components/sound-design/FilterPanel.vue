<script setup lang="ts">
// Filter tab: type/cutoff/resonance (moved out of LayerParamsEditor.vue)
// plus the Filter Envelope, per docs/plans/sound-design-ui.md. Filter
// values are edited/saved even though playback currently bypasses the
// filter stage entirely (see docs/ARCHITECTURE.md -- E-mu's exotic filter
// types have no BiquadFilterNode equivalent and a wrong estimate was
// silencing most presets) -- same data-vs-playback gap the built-in bank
// already has. Same self-query-from-useUserBanks pattern as
// LayerParamsEditor.vue. Cutoff/Resonance default to the FilterCurveGraph
// "drawing" view, dials behind a toggle -- same pattern as
// EnvelopeEditor.vue/ZoneEditor.vue.
import { ref, computed } from 'vue'
import { useUserBanks } from '../../composables/useUserBanks'
import Dial from './Dial.vue'
import EnvelopeEditor from './EnvelopeEditor.vue'
import FilterCurveGraph from './FilterCurveGraph.vue'
import { SlidersHorizontal } from '@lucide/vue'

const { activePreset, activeLayerIndex } = useUserBanks()

const layer = computed(() => {
  if (!activePreset.value || activeLayerIndex.value === null) return null
  return activePreset.value.layers[activeLayerIndex.value] ?? null
})

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'allpass', 'lowshelf', 'highshelf', 'peaking']

const fmtHz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`)
const fmtPlain = (v: number) => String(Math.round(v))

const showDials = ref(false)
</script>

<template>
  <div v-if="layer" class="flex flex-row flex-wrap gap-4 items-start">
    <div class="sd-panel flex flex-col gap-3 w-[30rem] shrink-0">
      <div class="flex items-center justify-between">
        <h3 class="sd-panel-title">Filter</h3>
        <button class="sd-btn sd-btn-icon" :title="showDials ? 'Hide dials' : 'Show dials'" @click="showDials = !showDials">
          <SlidersHorizontal :size="14" />
        </button>
      </div>
      <div class="text-xs" style="color: var(--color-ink-soft)">
        Filter is live in the preview below &mdash; built-in Orbit-3 presets still bypass it (unvalidated data, see ARCHITECTURE.md).
      </div>
      <label class="flex flex-col gap-1 text-xs">
        Type
        <select v-model="layer.params.filter.typeEstimated" class="sd-input text-xs">
          <option v-for="t in FILTER_TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
      </label>
      <FilterCurveGraph :filter="layer.params.filter" />
      <div v-if="showDials" class="flex flex-wrap gap-3 justify-center">
        <Dial v-model="layer.params.filter.cutoffHzEstimated" :min="20" :max="20000" :step="10" label="Cutoff" learn-id="sd:layer:cutoff" :format-value="fmtHz" />
        <Dial v-model="layer.params.filter.resonance" :min="0" :max="127" label="Resonance" learn-id="sd:layer:resonance" :format-value="fmtPlain" />
      </div>
    </div>

    <EnvelopeEditor :envelope="layer.filterEnv" title="Filter Envelope" />
  </div>
  <div v-else class="text-sm px-2 py-4" style="color: var(--color-ink-soft)">
    Select a layer in the Layers tab first.
  </div>
</template>
