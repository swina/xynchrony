<script setup lang="ts">
// Glide/Voice tab: patch-level portamento (Preset.glide), voice allocation
// mode (Preset.voiceMode/maxVoices), and note-latch/hold (Preset.latch).
// Same "takes the whole Preset as a prop, works identically in Sound
// Design and Performance mode" shape as FilterPanel.vue -- see its header
// comment. All three features are opt-in/off-by-default and lazily seeded
// here, same pattern as FilterPanel.vue's filter/filterEnv/filterBypassed;
// VoiceManager.ts/Voice.ts read them defensively so a preset that's never
// opened this tab behaves exactly as before. See docs/ARCHITECTURE.md.
import { watch } from 'vue'
import { blankGlide, blankLatch } from '../../core/soundDesign/defaults'
import type { Preset } from '../../core/audio/types'
import { useAudioEngine } from '../../composables/useAudioEngine'
import Dial from './Dial.vue'
import ToggleButton from './ToggleButton.vue'

const props = defineProps<{ preset: Preset | null }>()
const { releaseAllLatched } = useAudioEngine()

watch(() => props.preset, (preset) => {
  if (!preset) return
  preset.glide ??= blankGlide()
  preset.voiceMode ??= 'poly'
  preset.maxVoices ??= 8
  preset.latch ??= blankLatch()
}, { immediate: true })

const GLIDE_CURVES = ['linear', 'logarithmic'] as const
const fmtPlain = (v: number) => String(Math.round(v))

function onMaxVoicesInput(preset: Preset, raw: string) {
  const n = Math.round(Number(raw))
  preset.maxVoices = Math.min(16, Math.max(1, Number.isFinite(n) ? n : 1))
}
function onLatchMaxNotesInput(preset: Preset, raw: string) {
  const n = Math.round(Number(raw))
  preset.latch!.maxNotes = Math.min(6, Math.max(1, Number.isFinite(n) ? n : 1))
}
function onLatchToggle(preset: Preset, enabled: boolean) {
  preset.latch!.enabled = enabled
  if (!enabled) releaseAllLatched()
}
</script>

<template>
  <div v-if="preset && preset.glide && preset.latch" class="flex flex-row flex-wrap gap-2 items-start">
    <div class="sd-node flex flex-col gap-3 w-64 shrink-0">
      <h3 class="sd-panel-title">Voice Mode</h3>
      <select v-model="preset.voiceMode" class="sd-input text-xs font-mono">
        <option value="poly">Polyphonic</option>
        <option value="mono">Monophonic</option>
      </select>
      <label v-if="preset.voiceMode === 'poly'" class="flex items-center gap-2 text-xs">
        Voices
        <input
          type="number" min="1" max="16" class="sd-input text-xs w-16"
          :value="preset.maxVoices"
          @input="onMaxVoicesInput(preset, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <div v-else class="text-xs" style="color: var(--color-ink-soft)">
        Last-note-priority: releasing the top note of a held chord falls back to the previous one.
      </div>
    </div>

    <div class="sd-node flex flex-col gap-3 w-64 shrink-0">
      <h3 class="sd-panel-title">Glide</h3>
      <ToggleButton v-model="preset.glide.enabled" label="Enable glide" learn-id="sd:glide:enabled" />
      <label class="flex items-center gap-2 text-xs">
        Curve
        <select v-model="preset.glide.curve" class="sd-input text-xs font-mono">
          <option v-for="c in GLIDE_CURVES" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <div class="flex justify-center">
        <Dial v-model="preset.glide.rate" :min="0" :max="127" label="Rate" learn-id="sd:glide:rate" :format-value="fmtPlain" />
      </div>
    </div>

    <div class="sd-node flex flex-col gap-3 w-64 shrink-0">
      <h3 class="sd-panel-title">Latch</h3>
      <ToggleButton
        :model-value="preset.latch.enabled" label="Enable latch" learn-id="sd:latch:enabled"
        @update:model-value="onLatchToggle(preset, $event)"
      />
      <label class="flex items-center gap-2 text-xs">
        Max notes
        <input
          type="number" min="1" max="6" class="sd-input text-xs w-16"
          :value="preset.latch.maxNotes"
          @input="onLatchMaxNotesInput(preset, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <div class="text-xs" style="color: var(--color-ink-soft)">
        Held notes keep sounding after key-up; the oldest is released once a new one would exceed Max notes.
      </div>
    </div>
  </div>
  <div v-else class="text-sm px-2 py-4" style="color: var(--color-ink-soft)">
    Select or create a preset first.
  </div>
</template>
