<script setup lang="ts">
// Sound Design mode shell. Left pane (bank/preset management) + a tabbed
// main panel (Layers/Filter/Envelope/Aux/LFOs/Mod-Matrix) per
// docs/plans/sound-design-ui.md's Sound Design Layout.
import { ref, watch, computed } from 'vue'
import { useUserBanks } from '../../composables/useUserBanks'
import { useAudioEngine } from '../../composables/useAudioEngine'
import { AudioEngine } from '../../core/audio/AudioEngine'
import type { Bank } from '../../core/audio/types'
import { blankFxChain, normalizeFxChain } from '../../core/audio/effects'
import { blankLfo } from '../../core/soundDesign/defaults'
import BankManagerPanel from './BankManagerPanel.vue'
import PresetListPanel from './PresetListPanel.vue'
import LayerListPanel from './LayerListPanel.vue'
import LayerParamsEditor from './LayerParamsEditor.vue'
import ZoneListPanel from './ZoneListPanel.vue'
import ZoneEditor from './ZoneEditor.vue'
import FilterPanel from './FilterPanel.vue'
import EnvelopeScopeEditor from './EnvelopeScopeEditor.vue'
import LfoEditor from './LfoEditor.vue'
import ModMatrixEditor from './ModMatrixEditor.vue'
import FxChainEditor from './FxChainEditor.vue'
import ModulationEditor from './ModulationEditor.vue'
import GlideVoicePanel from './GlideVoicePanel.vue'
import PerformanceFooter from '../PerformanceFooter.vue'
import { Layers, Funnel, Activity, Sparkles, Radio, Grid3x3, Blend, Share2, Gauge } from '@lucide/vue'

const EDIT_BANK_ID = 'sound-design-scratch'
const EDIT_PRESET_KEY = 'edit'
const AUTOSAVE_DEBOUNCE_MS = 800

const { activeBank, activePreset, activeLayerIndex, persistActiveBank } = useUserBanks()
const { setPreset } = useAudioEngine()

const selectedLayer = computed(() => {
  if (!activePreset.value || activeLayerIndex.value === null) return null
  return activePreset.value.layers[activeLayerIndex.value] ?? null
})

type Tab = 'layers' | 'filter' | 'envelope' | 'aux' | 'lfos' | 'modmatrix' | 'fx' | 'patchmod' | 'voice'
const activeTab = ref<Tab>('layers')
const TABS: Array<{ id: Tab; label: string; icon: unknown }> = [
  { id: 'layers', label: 'Layers', icon: Layers },
  { id: 'filter', label: 'Filter', icon: Funnel },
  { id: 'envelope', label: 'Envelope', icon: Activity },
  { id: 'aux', label: 'AUX', icon: Sparkles },
  { id: 'lfos', label: 'LFOs', icon: Radio },
  { id: 'modmatrix', label: 'Mod/Matrix', icon: Grid3x3 },
  { id: 'fx', label: 'FX', icon: Blend },
  { id: 'patchmod', label: 'Patch Mod', icon: Share2 },
  { id: 'voice', label: 'Glide/Voice', icon: Gauge },
]

// FX/patch-level Modulation are optional/lazily-seeded Preset fields (same
// pattern as filter/filterEnv, ampEnv/auxEnv -- see core/audio/types.ts) --
// seed blanks on open so the FX/Patch Mod tabs always have something to
// bind to, same as FilterPanel.vue's existing pattern.
watch(activePreset, (preset) => {
  if (!preset) return
  // `??=` alone isn't enough here: a bank saved before the FX graph editor
  // shipped already has a truthy `preset.fx` in the legacy {slotA,slotB}
  // shape (no `nodes`/`edges`), which crashes FxChainEditor.vue trying to
  // read `chain.nodes.length` -- normalize it in place instead of only in
  // the audio engine's own render path (core/audio/effects.ts's rebuild()).
  preset.fx = preset.fx ? normalizeFxChain(preset.fx) : blankFxChain()
  preset.modMatrix ??= []
  preset.lfo1 ??= blankLfo()
  preset.lfo2 ??= blankLfo()
}, { immediate: true })

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
  <div class="flex flex-col items-center gap-1 w-full">
    <!-- Workarea Layout Structure: left pane (bank/preset) + main panel
         (tabbed layer editors) -- see docs/plans/sound-design-ui.md. -->
    <div class="flex flex-row gap-2 items-start w-full">
      <div class="flex flex-col gap-2 shrink-0">
        <BankManagerPanel />
        <PresetListPanel />
      </div>

      <div v-if="activeBank && activePreset" class="flex flex-col gap-1 flex-1 min-w-0">
        <div class="flex flex-wrap gap-1">
          <button
            v-for="tab in TABS"
            :key="tab.id"
            class="sd-btn inline-flex font-mono items-center gap-1.5"
            :class="activeTab === tab.id ? 'sd-btn-primary' : ''"
            @click="activeTab = tab.id"
          >
            <component :is="tab.icon" :size="14" /> {{ tab.label }}
          </button>
        </div>

        <div class="w-full overflow-x-auto sd-scroll pb-3">
          <div v-if="activeTab === 'layers'" class="flex flex-row gap-2 items-start">
            <LayerListPanel />
            <LayerParamsEditor />
            <ZoneListPanel />
            <ZoneEditor />
          </div>

          <FilterPanel v-else-if="activeTab === 'filter'" :preset="activePreset" />

          <template v-else-if="activeTab === 'envelope'">
            <EnvelopeScopeEditor v-if="selectedLayer && activePreset" :layer="selectedLayer" :preset="activePreset" kind="amp" title="Amp Envelope" />
            <div v-else class="text-sm px-2 py-4" style="color: var(--color-ink-soft)">Select a layer in the Layers tab first.</div>
          </template>

          <template v-else-if="activeTab === 'aux'">
            <EnvelopeScopeEditor v-if="selectedLayer && activePreset" :layer="selectedLayer" :preset="activePreset" kind="aux" title="Aux Envelope" />
            <div v-else class="text-sm px-2 py-4" style="color: var(--color-ink-soft)">Select a layer in the Layers tab first.</div>
          </template>

          <template v-else-if="activeTab === 'lfos'">
            <div v-if="selectedLayer" class="flex flex-row gap-2 items-start">
              <LfoEditor :lfo="selectedLayer.lfo1" title="LFO 1" />
              <LfoEditor :lfo="selectedLayer.lfo2" title="LFO 2" />
            </div>
            <div v-else class="text-sm px-2 py-4" style="color: var(--color-ink-soft)">Select a layer in the Layers tab first.</div>
          </template>

          <template v-else-if="activeTab === 'modmatrix'">
            <!-- <label v-if="activePreset" class="flex items-center gap-2 text-xs sd-panel py-2 mb-2 w-fit">
              <input
                :checked="activePreset.modMatrixBypassed === false"
                type="checkbox"
                @change="activePreset.modMatrixBypassed = ($event.target as HTMLInputElement).checked ? false : true"
              />
              Enable each layer's own Mod Matrix (off by default -- routings parsed from the original bank's hardware data were calibrated for a filter/routing model this app doesn't emulate, and some audibly wreck playback here. Doesn't affect the Patch Mod tab, which is always your own routings.)
            </label> -->
            <ModMatrixEditor v-if="selectedLayer" :layer="selectedLayer" />
            <div v-else class="text-sm px-2 py-4" style="color: var(--color-ink-soft)">Select a layer in the Layers tab first.</div>
          </template>

          <FxChainEditor v-else-if="activeTab === 'fx' && activePreset?.fx" :chain="activePreset.fx" learn-scope="a" />

          <ModulationEditor v-else-if="activeTab === 'patchmod' && activePreset" :preset="activePreset" />

          <GlideVoicePanel v-else-if="activeTab === 'voice'" :preset="activePreset" />
        </div>
      </div>
    </div>

    <template v-if="activeBank && activePreset">
      <p class="text-xs max-w-sm text-center" style="color: var(--color-ink-soft)">
        Live preview of "{{ activePreset.name }}". Select a layer in the Layers tab to edit its filter/envelopes/LFOs/
        mod matrix &mdash; drag a dial to set it, click its number to type a value, or right-click it and move a MIDI
        knob to bind it.
      </p>
      <PerformanceFooter />
    </template>
  </div>
</template>
