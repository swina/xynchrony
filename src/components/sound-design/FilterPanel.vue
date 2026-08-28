<script setup lang="ts">
// Filter tab: one filter per PATCH (preset), not per layer, per the user's
// direction -- a layer-scoped filter meant duplicating an Orbit-3 preset
// carried over that layer's unvalidated, often-silencing estimate as soon
// as filter playback was enabled for Sound Design data; a patch-level
// filter always starts wide-open/safe on duplicate regardless of what the
// source layers had (see UserBankStore.duplicatePresetInto). Data lives on
// Preset.filter/Preset.filterEnv (core/audio/types.ts) rather than per
// Layer, so this component works with no layer selected at all -- takes
// `preset` as a prop rather than self-querying useUserBanks() so it's
// reusable outside Sound Design too (Performance mode's Filter tab, see
// PerformanceView.vue). Works identically regardless of which bank the
// preset is from -- `preset.filter`/`filterEnv` are only ever either absent
// or explicitly set by a human through a Filter tab, never derived from a
// bank's own raw per-layer filter estimate (see Voice.ts), so there's
// nothing bank-specific to gate here. Cutoff/Resonance default to the
// FilterCurveGraph "drawing" view, dials behind a toggle -- same pattern as
// EnvelopeEditor.vue/ZoneEditor.vue.
//
// Filtering is opt-in (`filterBypassed` defaults to true): even a "wide
// open" filter isn't acoustically transparent -- confirmed live, a
// duplicated `hit:Intruder` had a masked pure-sine layer become audible as
// soon as filtering engaged, at cutoff=20kHz/Q=0.707, because a real 2-pole
// lowpass still rolls off ultra-high content a cymbal layer has plenty of,
// shifting the mix balance. See docs/ARCHITECTURE.md. There's no cutoff
// value that's simultaneously "has headroom" and "byte-for-byte identical
// to unfiltered", so a fresh duplicate/blank preset starts with filtering
// OFF instead, and the user turns it on deliberately when they want to
// shape the sound.
import { watch, ref } from 'vue'
import { blankFilter, blankEnvelope } from '../../core/soundDesign/defaults'
import type { Preset } from '../../core/audio/types'
import Dial from './Dial.vue'
import EnvelopeEditor from './EnvelopeEditor.vue'
import FilterCurveGraph from './FilterCurveGraph.vue'
import ToggleButton from './ToggleButton.vue'
import { SlidersHorizontal } from '@lucide/vue'

const props = defineProps<{ preset: Preset | null }>()

// Presets saved before the patch-level filter existed won't have
// filter/filterEnv/filterBypassed yet -- seed them in place (same object
// the autosave watcher persists, or Performance mode's explicit Save) the
// moment such a preset is opened here, rather than making every consumer
// handle "maybe undefined". Retroactively defaulting filterBypassed to true
// too, so a preset duplicated earlier in this session (before opt-in
// existed) also starts silent/off, not surprise-filtered, the next time
// it's opened.
watch(() => props.preset, (preset) => {
  if (!preset) return
  preset.filter ??= blankFilter()
  preset.filterEnv ??= blankEnvelope()
  preset.filterBypassed ??= false
}, { immediate: true })

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'allpass', 'lowshelf', 'highshelf', 'peaking']

const fmtHz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`)
const fmtPlain = (v: number) => String(Math.round(v))

const showDials = ref(false)
</script>

<template>
  <div v-if="preset && preset.filter && preset.filterEnv" class="flex flex-row flex-wrap gap-2 items-start">
    <div class="sd-node flex flex-col gap-3 w-[30rem] shrink-0">
      <div class="flex items-center justify-between">
        <h3 class="sd-panel-title">Filter (whole patch)</h3>
        <button class="sd-btn sd-btn-icon" :title="showDials ? 'Hide dials' : 'Show dials'" @click="showDials = !showDials">
          <SlidersHorizontal :size="14" />
        </button>
      </div>
      <div class="flex flex-wrap gap-4 items-center">
        <ToggleButton
          :model-value="!preset.filterBypassed" label="Enable filter" learn-id="sd:filter:enabled"
          @update:model-value="preset.filterBypassed = !$event"
        />
        <label class="flex flex-wrap items-center gap-4 text-xs">
          <!-- Type -->
          <select v-model="preset.filter.typeEstimated" class="sd-input text-xs font-mono">
            <option v-for="t in FILTER_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
      </div>
      <FilterCurveGraph :filter="preset.filter" />
      <!-- <div class="text-xs" style="color: var(--color-ink-soft)">
        One filter for the whole patch &mdash; applies to every layer. Built-in Orbit-3 presets still bypass filtering entirely (unvalidated data, see ARCHITECTURE.md).
      </div> -->
      <div v-if="showDials" class="flex flex-wrap gap-3 justify-center">
        <Dial v-model="preset.filter.cutoffHzEstimated" :min="20" :max="20000" :step="10" label="Cutoff" learn-id="sd:filter:cutoff" :format-value="fmtHz" />
        <Dial v-model="preset.filter.resonance" :min="0" :max="127" label="Resonance" learn-id="sd:filter:resonance" :format-value="fmtPlain" />
      </div>
    </div>

    <EnvelopeEditor :envelope="preset.filterEnv" title="Filter Envelope" />
  </div>
  <div v-else class="text-sm px-2 py-4" style="color: var(--color-ink-soft)">
    Select or create a preset first.
  </div>
</template>
