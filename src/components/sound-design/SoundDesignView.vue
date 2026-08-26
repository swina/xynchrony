<script setup lang="ts">
// Sound Design mode shell. Left pane (bank/preset management) + a tabbed
// main panel (Layers/Filter/Envelope/Aux/LFOs/Mod-Matrix) per
// docs/plans/sound-design-ui.md's Sound Design Layout.
import { ref, watch, computed } from 'vue'
import { useUserBanks } from '../../composables/useUserBanks'
import { useAudioEngine } from '../../composables/useAudioEngine'
import { AudioEngine } from '../../core/audio/AudioEngine'
import type { Bank } from '../../core/audio/types'
import BankManagerPanel from './BankManagerPanel.vue'
import PresetListPanel from './PresetListPanel.vue'
import LayerListPanel from './LayerListPanel.vue'
import LayerParamsEditor from './LayerParamsEditor.vue'
import ZoneListPanel from './ZoneListPanel.vue'
import ZoneEditor from './ZoneEditor.vue'
import FilterPanel from './FilterPanel.vue'
import EnvelopeEditor from './EnvelopeEditor.vue'
import LfoEditor from './LfoEditor.vue'
import ModMatrixEditor from './ModMatrixEditor.vue'
import VirtualKeyboard from '../VirtualKeyboard.vue'
import VoiceActivityView from '../VoiceActivityView.vue'
import { Layers, Funnel, Activity, Sparkles, Radio, Grid3x3 } from '@lucide/vue'

const EDIT_BANK_ID = 'sound-design-scratch'
const EDIT_PRESET_KEY = 'edit'
const AUTOSAVE_DEBOUNCE_MS = 800

const { activeBank, activePreset, activeLayerIndex, persistActiveBank } = useUserBanks()
const { setPreset } = useAudioEngine()

const selectedLayer = computed(() => {
  if (!activePreset.value || activeLayerIndex.value === null) return null
  return activePreset.value.layers[activeLayerIndex.value] ?? null
})

type Tab = 'layers' | 'filter' | 'envelope' | 'aux' | 'lfos' | 'modmatrix'
const activeTab = ref<Tab>('layers')
const TABS: Array<{ id: Tab; label: string; icon: unknown }> = [
  { id: 'layers', label: 'Layers', icon: Layers },
  { id: 'filter', label: 'Filter', icon: Funnel },
  { id: 'envelope', label: 'Envelope', icon: Activity },
  { id: 'aux', label: 'Aux', icon: Sparkles },
  { id: 'lfos', label: 'LFOs', icon: Radio },
  { id: 'modmatrix', label: 'Mod/Matrix', icon: Grid3x3 },
]

// Debounced autosave: covers every editor added in M9/M10 (layer/zone
// structural edits, envelope/LFO/mod-matrix parameter tweaks) without each
// of them needing to call save explicitly. `persistActiveBank` (not
// `saveActiveBank`) deliberately skips reloading `banks` from the DB, so a
// slider mid-drag doesn't get its backing object swapped out from under it.
let autosaveTimer: ReturnType<typeof setTimeout> | null = null
watch(activeBank, () => {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => { void persistActiveBank() }, AUTOSAVE_DEBOUNCE_MS)
}, { deep: true })

// Live audition: wrap the preset currently being edited in a synthetic
// one-preset Bank and load it. Because the Preset object is the SAME
// reactive object activePreset points at (not a copy), any field-level
// edit made by the M9/M10 editors is picked up on the next note-on with
// no re-wiring needed -- see docs/ARCHITECTURE.md / approved plan §1.3.
// Only re-wire when *which* preset is being edited changes.
watch(activePreset, (preset) => {
  if (!preset) return
  const scratchBank: Bank = {
    _meta: {
      schemaVersion: 2, bankId: EDIT_BANK_ID, bankName: 'Sound Design (live)',
      source: 'sound-design-live-preview', rootKeyConvention: 'E-mu octave convention: C3 = MIDI 60',
      presetCount: 1, totalLayers: preset.layers.length,
      totalZones: preset.layers.reduce((n, l) => n + l.zones.length, 0),
      unresolvedSamples: 0, notes: {},
    },
    presets: { [EDIT_PRESET_KEY]: preset },
  }
  AudioEngine.loadBank(scratchBank, EDIT_BANK_ID)
  setPreset(EDIT_PRESET_KEY)
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col items-center gap-4 w-full">
    <!-- Workarea Layout Structure: left pane (bank/preset) + main panel
         (tabbed layer editors) -- see docs/plans/sound-design-ui.md. -->
    <div class="flex flex-row gap-4 items-start w-full">
      <div class="flex flex-col gap-4 shrink-0">
        <BankManagerPanel />
        <PresetListPanel />
      </div>

      <div v-if="activeBank && activePreset" class="flex flex-col gap-3 flex-1 min-w-0">
        <div class="flex flex-wrap gap-1">
          <button
            v-for="tab in TABS"
            :key="tab.id"
            class="sd-btn inline-flex items-center gap-1.5"
            :class="activeTab === tab.id ? 'sd-btn-primary' : ''"
            @click="activeTab = tab.id"
          >
            <component :is="tab.icon" :size="14" /> {{ tab.label }}
          </button>
        </div>

        <div class="w-full overflow-x-auto sd-scroll pb-3">
          <div v-if="activeTab === 'layers'" class="flex flex-row gap-4 items-start">
            <LayerListPanel />
            <LayerParamsEditor />
            <ZoneListPanel />
            <ZoneEditor />
          </div>

          <FilterPanel v-else-if="activeTab === 'filter'" />

          <template v-else-if="activeTab === 'envelope'">
            <EnvelopeEditor v-if="selectedLayer" :envelope="selectedLayer.ampEnv" title="Amp Envelope" />
            <div v-else class="text-sm px-2 py-4" style="color: var(--color-ink-soft)">Select a layer in the Layers tab first.</div>
          </template>

          <template v-else-if="activeTab === 'aux'">
            <EnvelopeEditor v-if="selectedLayer" :envelope="selectedLayer.auxEnv" title="Aux Envelope" />
            <div v-else class="text-sm px-2 py-4" style="color: var(--color-ink-soft)">Select a layer in the Layers tab first.</div>
          </template>

          <template v-else-if="activeTab === 'lfos'">
            <div v-if="selectedLayer" class="flex flex-row gap-4 items-start">
              <LfoEditor :lfo="selectedLayer.lfo1" title="LFO 1" />
              <LfoEditor :lfo="selectedLayer.lfo2" title="LFO 2" />
            </div>
            <div v-else class="text-sm px-2 py-4" style="color: var(--color-ink-soft)">Select a layer in the Layers tab first.</div>
          </template>

          <template v-else-if="activeTab === 'modmatrix'">
            <ModMatrixEditor v-if="selectedLayer" :layer="selectedLayer" />
            <div v-else class="text-sm px-2 py-4" style="color: var(--color-ink-soft)">Select a layer in the Layers tab first.</div>
          </template>
        </div>
      </div>
    </div>

    <template v-if="activeBank && activePreset">
      <VoiceActivityView />
      <VirtualKeyboard />
      <p class="text-xs max-w-sm text-center" style="color: var(--color-ink-soft)">
        Live preview of "{{ activePreset.name }}". Select a layer in the Layers tab to edit its filter/envelopes/LFOs/
        mod matrix &mdash; drag a dial to set it, click its number to type a value, or click "learn" and move a MIDI
        knob to bind it.
      </p>
    </template>
  </div>
</template>
