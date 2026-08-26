<script setup lang="ts">
// App shell header: Logo - Performance/Sound Design switcher - Bank
// Selector - Current Patch - MIDI device - Master Volume - Panic, per
// docs/plans/sound-design-ui.md's Panels layout. Self-contained (queries
// composables directly) rather than prop-drilling, matching
// PerformanceView.vue's existing pattern. Absorbs what used to be
// TransportBar.vue (deleted) plus the bank-switch logic that used to live
// in PerformanceView.vue -- see logPatchMapping.ts for why that's now a
// shared util instead of copy-pasted.
import { onMounted } from 'vue'
import { usePresetLibrary } from '../composables/usePresetLibrary'
import { useAudioEngine } from '../composables/useAudioEngine'
import { useMidiInput } from '../composables/useMidiInput'
import { useUserBanks } from '../composables/useUserBanks'
import { AudioEngine } from '../core/audio/AudioEngine'
import { logPatchMapping } from '../utils/logPatchMapping'
import ModeSwitcher from './ModeSwitcher.vue'
import BankSelector from './BankSelector.vue'
import { OctagonAlert, Volume2 } from '@lucide/vue'

defineProps<{ mode: 'performance' | 'soundDesign' }>()
const emit = defineEmits<{ change: [mode: 'performance' | 'soundDesign'] }>()

const { manifest, currentBankId, loadBank } = usePresetLibrary()
const { masterVolume, setMasterVolume, setPreset, currentPreset, panic } = useAudioEngine()
const { isSupported, devices, selectedId, init, selectDevice } = useMidiInput()
const { activeBank } = useUserBanks()

onMounted(() => {
  if (isSupported) void init()
})

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
    <span class="xy-logo text-xl shrink-0" style="color: var(--color-primary-dark)">Xynchrony</span>

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

    <div class="flex-1 text-sm truncate text-center min-w-24">
      {{ currentPreset?.name ?? 'No preset loaded' }}
    </div>

    <div v-if="isSupported" class="flex items-center gap-2">
      <label class="text-xs" style="color: var(--color-ink-soft)">MIDI</label>
      <select
        :value="selectedId ?? ''"
        class="sd-input text-xs"
        @change="selectDevice(($event.target as HTMLSelectElement).value || null)"
      >
        <option value="" disabled>{{ devices.length ? 'Select device' : 'No devices found' }}</option>
        <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name }}</option>
      </select>
    </div>
    <div v-else class="text-xs" style="color: var(--color-danger)">Web MIDI not supported</div>

    <div class="flex items-center gap-2">
      <Volume2 :size="14" style="color: var(--color-ink-soft)" />
      <input
        type="range" min="0" max="1" step="0.01"
        :value="masterVolume"
        class="w-24"
        @input="setMasterVolume(Number(($event.target as HTMLInputElement).value))"
      />
    </div>

    <button class="sd-btn sd-btn-danger inline-flex items-center gap-1" @click="panic()"><OctagonAlert :size="14" /> Panic</button>
  </div>
</template>
