<script setup lang="ts">
// App shell header: Logo - Performance/Sound Design switcher - Bank
// Selector - Current Patch, per docs/plans/sound-design-ui.md's Panels
// layout. MIDI device/BPM/Master Volume/Global FX/Panic moved out to
// TransportToolbar.vue (see PerformanceFooter.vue) -- always-want-at-hand
// playing controls belong next to the on-screen keyboard, not the page
// header. Self-contained (queries composables directly) rather than
// prop-drilling, matching PerformanceView.vue's existing pattern. Absorbs
// what used to be TransportBar.vue (deleted) plus the bank-switch logic
// that used to live in PerformanceView.vue -- see logPatchMapping.ts for
// why that's now a shared util instead of copy-pasted.
import { usePresetLibrary } from '../composables/usePresetLibrary'
import { useAudioEngine } from '../composables/useAudioEngine'
import { useUserBanks } from '../composables/useUserBanks'
import { AudioEngine } from '../core/audio/AudioEngine'
import { logPatchMapping } from '../utils/logPatchMapping'
import ModeSwitcher from './ModeSwitcher.vue'
import BankSelector from './BankSelector.vue'

defineProps<{ mode: 'performance' | 'soundDesign' }>()
const emit = defineEmits<{ change: [mode: 'performance' | 'soundDesign'] }>()

const { manifest, currentBankId, loadBank } = usePresetLibrary()
const { setPreset, currentPreset } = useAudioEngine()
const { activeBank } = useUserBanks()

async function switchBank(bankId: string) {
  const bank = await loadBank(bankId)
  AudioEngine.loadBank(bank, bankId)
  const firstPreset = Object.keys(bank.presets).sort()[0]
  if (firstPreset) {
    setPreset(firstPreset)
    logPatchMapping(bank, firstPreset)
  }
}
</script>

<template>
  <div class="sd-panel flex flex-wrap items-center gap-4 w-full">
    <span class="xy-logo text-xl shrink-0" style="color: var(--color-primary-dark)"><span class="bg-mocha-200 border border-neutral-700 mr-1 text-white text-2xl px-2 py-1 rounded-full">X</span>ynchrony</span>

    <ModeSwitcher :mode="mode" @change="emit('change', $event)" />

    <BankSelector
      v-if="mode === 'performance' && manifest.length > 1"
      :banks="manifest"
      :active-bank-id="currentBankId"
      @select="switchBank"
    />
    <span v-else-if="mode === 'soundDesign' && activeBank" class="text-xs" style="color: var(--color-ink-soft)">
      Editing: {{ activeBank.name }}
    </span>

    <div class="flex-1 bg-mocha-50 rounded-lg p-1 text-lg truncate font-mono font-bold text-center min-w-24">
      {{ currentPreset?.name ?? 'No preset loaded' }}
    </div>
  </div>
</template>
