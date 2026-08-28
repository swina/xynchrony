<script setup lang="ts">
// Reusable LFO editor, mounted 2x per layer (SoundDesignView's LFOs tab,
// plain mode) and 2x per patch (ModulationEditor.vue's Modulation canvas,
// `patchMode` -- FX-node-style collapse/bypass/remove chrome, default
// collapsed, mirroring FxChainEditor.vue's FX nodes). See
// EnvelopeEditor.vue for why direct prop-field mutation is the right
// pattern here, and why `learnId`s are scoped by `title` (LFO 1 / LFO 2).
import { ref, computed } from 'vue'
import type { Lfo } from '../../core/audio/types'
import { lfoRateToHz, SYNC_DIVISIONS } from '../../core/audio/lfoMapping'
import Dial from './Dial.vue'
import { ChevronDown, ChevronRight, Power, X } from '@lucide/vue'

// `showSync` gates the Hz/Sync mode toggle -- only meaningful for
// patch-level LFOs (Preset.lfo1/lfo2), which have an app-wide BPM to sync
// against (see useGlobalTempo.ts). `patchMode` gates the collapse/bypass/
// remove node chrome -- only meaningful on the Modulation canvas, where
// this LFO is a removable, bypassable node rather than a fixed per-layer
// control block. Per-layer LFOs (Layer.lfo1/lfo2) never pass either.
const props = defineProps<{ lfo: Lfo; title: string; showSync?: boolean; patchMode?: boolean }>()
const emit = defineEmits<{ remove: [] }>()

const SHAPES = ['triangle', 'sine', 'sawtooth', 'square']

const scope = computed(() => props.title.toLowerCase().replace(/\s+/g, '-'))
const fmtPlain = (v: number) => String(Math.round(v))
const fmtHz = (v: number) => `${lfoRateToHz(v).toFixed(2)}Hz`

function setRateMode(mode: 'hz' | 'sync') {
  props.lfo.rateMode = mode
  if (mode === 'sync' && !props.lfo.syncDivision) props.lfo.syncDivision = '1/4'
}

// Canvas node display state only, not persisted data (same as
// FxChainEditor's `expandedNodes`) -- defaults collapsed.
const expanded = ref(false)
</script>

<template>
  <div class="flex flex-col gap-3 w-56 shrink-0" :class="patchMode ? 'sd-node-mod' : 'sd-panel'">
    <div v-if="patchMode" class="flex items-center justify-between gap-1">
      <button class="sd-btn sd-btn-icon" style="width: 20px; height: 20px" :title="expanded ? 'Collapse' : 'Expand controls'" @click="expanded = !expanded">
        <ChevronDown v-if="expanded" :size="12" />
        <ChevronRight v-else :size="12" />
      </button>
      <span class="text-xs font-bold truncate flex-1">{{ title }}</span>
      <button
        class="sd-btn sd-btn-icon" style="width: 20px; height: 20px"
        :class="lfo.bypass ? '' : 'sd-btn-primary'"
        :title="lfo.bypass ? 'Bypassed -- click to re-enable' : 'Click to bypass'"
        @click="lfo.bypass = !lfo.bypass"
      >
        <Power :size="12" />
      </button>
      <button class="sd-btn sd-btn-icon sd-btn-danger" style="width: 20px; height: 20px" title="Remove node" @click="emit('remove')"><X :size="12" /></button>
    </div>
    <h4 v-else class="sd-panel-title">{{ title }}</h4>

    <template v-if="!patchMode || expanded">
      <div v-if="showSync" class="flex gap-1 text-xs justify-center">
        <button
          class="sd-btn" :class="(lfo.rateMode ?? 'hz') === 'hz' ? 'sd-btn-primary' : ''"
          @click="setRateMode('hz')"
        >Hz</button>
        <button
          class="sd-btn" :class="lfo.rateMode === 'sync' ? 'sd-btn-primary' : ''"
          @click="setRateMode('sync')"
        >Sync</button>
      </div>

      <div class="flex flex-wrap gap-3 justify-center">
        <select
          v-if="showSync && lfo.rateMode === 'sync'"
          v-model="lfo.syncDivision" class="sd-input text-xs"
        >
          <option v-for="d in SYNC_DIVISIONS" :key="d" :value="d">{{ d }}</option>
        </select>
        <Dial v-else v-model="lfo.rate" :min="0" :max="127" label="Rate" :learn-id="`sd:lfo:${scope}:rate`" :format-value="showSync ? fmtHz : fmtPlain" />
        <Dial v-model="lfo.delay" :min="0" :max="127" label="Delay" :learn-id="`sd:lfo:${scope}:delay`" :format-value="fmtPlain" />
        <Dial v-model="lfo.variation" :min="0" :max="127" label="Variation" :learn-id="`sd:lfo:${scope}:variation`" :format-value="fmtPlain" />
      </div>
      <label class="flex flex-col gap-1 text-xs">
        Shape
        <select v-model="lfo.shape" class="sd-input text-xs">
          <option v-for="s in SHAPES" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <label class="flex items-center gap-2 text-xs">
        <input type="checkbox" :checked="lfo.sync === 'freeRun'" @change="lfo.sync = ($event.target as HTMLInputElement).checked ? 'freeRun' : 'keySync'" />
        Free-run (unchecked = key-synced)
      </label>
    </template>
  </div>
</template>
