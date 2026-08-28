<script setup lang="ts">
// Transport controls -- MIDI device, global BPM, Master Volume, Global FX,
// Panic -- split out of TopBar.vue so they live in the fixed bottom bar
// (PerformanceFooter.vue, under the on-screen keyboard) instead of the
// page header: these are all "always want at hand while playing" controls,
// same reasoning as the keyboard itself being pinned to the viewport.
// Self-contained (queries composables directly), same pattern TopBar.vue
// used before this split. The Global FX popover opens upward (`bottom-full`
// instead of `top-full`) since this toolbar now sits at the bottom of the
// viewport -- opening downward would push it off-screen.
import { ref, computed, onMounted } from 'vue'
import { useAudioEngine } from '../composables/useAudioEngine'
import { useMidiInput } from '../composables/useMidiInput'
import { useGlobalFx } from '../composables/useGlobalFx'
import { useGlobalTempo } from '../composables/useGlobalTempo'
import { useKeyboardVisibility } from '../composables/useKeyboardVisibility'
import FxChainEditor from './sound-design/FxChainEditor.vue'
import { OctagonAlert, Volume2, Blend, Piano } from '@lucide/vue'

const { masterVolume, setMasterVolume, panic } = useAudioEngine()
const { isSupported, devices, selectedId, init, selectDevice } = useMidiInput()
const { config: globalFxConfig } = useGlobalFx()
const { bpm, MIN_BPM, MAX_BPM } = useGlobalTempo()
const { visible: keyboardVisible, toggle: toggleKeyboard } = useKeyboardVisibility()

const showGlobalFx = ref(false)
// "Set" = has at least one node patched in -- blankFxChain() starts with
// none (a plain dry Input->Output cable), so this is a reliable at-a-
// glance "Global FX is actually doing something" indicator distinct from
// showGlobalFx (which only reflects whether the popover is open).
const hasGlobalFx = computed(() => globalFxConfig.value.nodes.length > 0)

onMounted(() => {
  if (isSupported) void init()
})
</script>

<template>
  <div class="flex flex-wrap items-center justify-center gap-4">
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

    <div class="flex items-center gap-1" title="Global BPM -- used by tempo-synced patch-level LFOs (Modulation panel)">
      <label class="text-xs" style="color: var(--color-ink-soft)">BPM</label>
      <input
        type="number" :min="MIN_BPM" :max="MAX_BPM" step="1"
        :value="bpm"
        class="sd-input text-xs w-14"
        @change="bpm = Number(($event.target as HTMLInputElement).value)"
      />
    </div>

    <div class="flex items-center gap-2">
      <Volume2 :size="14" style="color: var(--color-ink-soft)" />
      <input
        type="range" min="0" max="1" step="0.01"
        :value="masterVolume"
        class="w-24"
        @input="setMasterVolume(Number(($event.target as HTMLInputElement).value))"
      />
    </div>

    <div class="relative">
      <button
        class="sd-btn sd-btn-icon"
        :class="showGlobalFx ? 'sd-btn-primary' : (hasGlobalFx ? 'sd-btn-mocha' : '')"
        :title="hasGlobalFx ? 'Global FX is active (applies to every preset, on the master bus)' : 'Global FX (applies to every preset, on the master bus)'"
        @click="showGlobalFx = !showGlobalFx"
      >
        <Blend :size="14" />
      </button>
      <div
        v-if="showGlobalFx"
        class="sd-panel absolute right-0 bottom-full mb-2 z-50 flex flex-col gap-3"
        style="background-color: var(--color-cream); width: 640px"
      >
        <div class="flex items-center justify-between gap-4">
          <h3 class="sd-panel-title">Global FX (master bus, every preset)</h3>
          <button class="sd-btn sd-btn-icon" @click="showGlobalFx = false">&times;</button>
        </div>
        <FxChainEditor :chain="globalFxConfig" learn-scope="global" />
      </div>
    </div>

    <button class="sd-btn sd-btn-danger inline-flex items-center gap-1" @click="panic()"><OctagonAlert :size="14" /> Panic</button>

    <button
      class="sd-btn sd-btn-icon"
      :class="keyboardVisible ? 'sd-btn-primary' : ''"
      :title="keyboardVisible ? 'Hide keyboard' : 'Show keyboard'"
      @click="toggleKeyboard"
    >
      <Piano :size="14" />
    </button>
  </div>
</template>
