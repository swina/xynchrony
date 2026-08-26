<script setup lang="ts">
// Reusable LFO editor, mounted 2x per layer. See EnvelopeEditor.vue for
// why direct prop-field mutation is the right pattern here, and why
// `learnId`s are scoped by `title` (LFO 1 / LFO 2).
import { computed } from 'vue'
import type { Lfo } from '../../core/audio/types'
import Dial from './Dial.vue'

const props = defineProps<{ lfo: Lfo; title: string }>()

const SHAPES = ['triangle', 'sine', 'sawtooth', 'square']

const scope = computed(() => props.title.toLowerCase().replace(/\s+/g, '-'))
const fmtPlain = (v: number) => String(Math.round(v))
</script>

<template>
  <div class="sd-panel flex flex-col gap-3 w-56 shrink-0">
    <h4 class="sd-panel-title">{{ title }}</h4>
    <div class="flex flex-wrap gap-3 justify-center">
      <Dial v-model="lfo.rate" :min="0" :max="127" label="Rate" :learn-id="`sd:lfo:${scope}:rate`" :format-value="fmtPlain" />
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
  </div>
</template>
