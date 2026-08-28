<script setup lang="ts">
// Reusable 6-stage envelope editor, mounted 3x per layer (amp/filter/aux).
// `envelope` is the same reactive object living inside activePreset's tree
// -- mutating its fields directly (not emit-based v-model) is the same
// pattern LfoEditor.vue/LayerParamsEditor.vue use; Vue only warns about
// reassigning a prop variable itself, not mutating a prop object's own
// fields. Aux's on-disk stage-order quirk was already normalized to this
// same {attack1,decay1,release1,attack2,decay2,release2} shape by
// tools/build_bank.py, so this one editor works for all three unchanged.
// `learnId`s are scoped by `title` (amp/filter/aux) so the three mounted
// copies don't collide on the same MIDI Learn bindings. EnvelopeDesigner.vue
// is the visual "shape by eye" graph above the dials -- both edit the same
// reactive `envelope` object, so dragging a breakpoint and nudging its dial
// stay in sync automatically. Drawing mode (the graph) is the default view
// per docs/plans/sound-design-ui.md; the precise/MIDI-learnable dial grid
// is hidden behind a toggle rather than always shown.
import { ref, computed } from 'vue'
import type { Envelope } from '../../core/audio/types'
import Dial from './Dial.vue'
import EnvelopeDesigner from './EnvelopeDesigner.vue'
import { SlidersHorizontal } from '@lucide/vue'

const props = defineProps<{ envelope: Envelope; title: string }>()

const showDials = ref(false)

const STAGES: Array<{ key: 'attack1' | 'attack2' | 'decay1' | 'decay2' | 'release1' | 'release2'; label: string }> = [
  { key: 'attack1', label: 'A1' },
  { key: 'decay1', label: 'D1' },
  { key: 'release1', label: 'R1' },
  { key: 'attack2', label: 'A2' },
  { key: 'decay2', label: 'D2' },
  { key: 'release2', label: 'R2' },
]

const scope = computed(() => props.title.toLowerCase().replace(/\s+/g, '-'))

const fmtPlain = (v: number) => String(Math.round(v))
</script>

<template>
  <div class="sd-node flex flex-col gap-3 w-[30rem] shrink-0">
    <div class="flex items-center justify-between mb-9">
      <h4 class="sd-panel-title">{{ title }}</h4>
      <button class="sd-btn sd-btn-icon" :title="showDials ? 'Hide dials' : 'Show dials'" @click="showDials = !showDials">
        <SlidersHorizontal :size="14" />
      </button>
    </div>
    <EnvelopeDesigner :envelope="envelope" />
    <div v-if="showDials" class="grid grid-cols-3 gap-x-2 gap-y-3">
      <div v-for="stage in STAGES" :key="stage.key" class="flex flex-col items-center gap-1">
        <div class="text-[0.65rem] font-semibold" style="color: var(--color-ink-soft)">{{ stage.label }}</div>
        <div class="flex gap-2">
          <Dial
            v-model="(envelope as any)[stage.key + 'Rate']"
            :min="0" :max="255" :size="40"
            label="rate"
            :learn-id="`sd:env:${scope}:${stage.key}:rate`"
            :format-value="fmtPlain"
          />
          <Dial
            v-if="stage.key !== 'decay1'"
            v-model="(envelope as any)[stage.key + 'Level']"
            :min="0" :max="127" :size="40"
            label="level"
            :learn-id="`sd:env:${scope}:${stage.key}:level`"
            :format-value="fmtPlain"
          />
          <Dial
            v-else
            v-model="envelope.sustainLevel"
            :min="0" :max="127" :size="40"
            label="sustain"
            title="Decay1's 'level' field is the envelope's sustain level"
            :learn-id="`sd:env:${scope}:decay1:sustain`"
            :format-value="fmtPlain"
          />
        </div>
      </div>
    </div>
  </div>
</template>
