<script setup lang="ts">
// Polyphony counter + master level meter. Per-voice individual meters are
// deferred to M6 polish (see docs/ARCHITECTURE.md §7 / the approved plan).
import { computed } from 'vue'
import { useAudioEngine } from '../composables/useAudioEngine'

const { activeVoiceCount, meterLevel } = useAudioEngine()
const POLYPHONY_LIMIT = 64

const meterWidthPct = computed(() => Math.min(100, meterLevel.value * 130))
</script>

<template>
  <div class="flex items-center gap-3 text-xs w-full max-w-3xl" style="color: var(--color-ink-soft)">
    <span class="font-mono shrink-0">{{ activeVoiceCount }}/{{ POLYPHONY_LIMIT }} voices</span>
    <div class="flex-1 h-2 rounded-full overflow-hidden" style="background-color: var(--color-mocha)">
      <div
        class="h-full transition-[width] duration-75"
        style="background: linear-gradient(to right, var(--color-sage), var(--color-primary))"
        :style="{ width: meterWidthPct + '%' }"
      />
    </div>
  </div>
</template>
