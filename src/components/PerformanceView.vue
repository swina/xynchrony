<script setup lang="ts">
// Performance mode: a three-pane workarea (Presets / FX / Modulation),
// mirroring Sound Design's layout -- see docs/plans/FX-Modulations.md.
// The "Enable audio" gate stays at the App.vue level since Sound Design
// mode needs the same prerequisite (a started AudioEngine for live
// audition); loading the manifest/default bank also stays there (it's
// display state for the whole app, e.g. the loading/error screens).
//
// AudioEngine itself only holds ONE loaded bank+preset at a time -- Sound
// Design mode's live-preview watcher (SoundDesignView.vue) overwrites it
// with its own scratch bank whenever active. Re-asserting Performance's
// bank/preset here on every mount (not just once at app startup) is what
// makes switching back from Sound Design mode work instead of throwing
// "Preset ... not found in loaded bank" on the next preset click.
import { ref, computed, watch, onMounted } from 'vue'
import { usePresetLibrary } from '../composables/usePresetLibrary'
import { useAudioEngine } from '../composables/useAudioEngine'
import { AudioEngine } from '../core/audio/AudioEngine'
import { blankFxChain } from '../core/audio/effects'
import { blankLfo } from '../core/soundDesign/defaults'
import { logPatchMapping } from '../utils/logPatchMapping'
import PresetBrowser from './PresetBrowser.vue'
import VirtualKeyboard from './VirtualKeyboard.vue'
import VoiceActivityView from './VoiceActivityView.vue'
import FxChainEditor from './sound-design/FxChainEditor.vue'
import ModulationEditor from './sound-design/ModulationEditor.vue'
import FilterPanel from './sound-design/FilterPanel.vue'
import EnvelopeScopeEditor from './sound-design/EnvelopeScopeEditor.vue'
import { Save, Blend, Share2, Funnel, Activity } from '@lucide/vue'

const { currentBank, currentBankId, lastPerformancePresetKey, isCurrentBankSaveable, persistCurrentBank } = usePresetLibrary()
const { setPreset, currentBankProg, currentPreset } = useAudioEngine()

// FX/Modulation/Filter/Envelope are tabbed, not side-by-side, so whichever
// is active gets the full pane width instead of splitting it -- each patch
// canvas also supports its own resize handle/full-screen toggle
// (PatchCanvasFrame.vue) on top of this.
type Tab = 'filter' | 'fx' | 'envelope' | 'modulation' 
const activeTab = ref<Tab>('filter')

// Amp Envelope is per-Layer (EnvelopeScopeEditor.vue), unlike Filter/FX/
// Modulation which are already patch-level -- Performance mode needs
// *some* layer selected to show it, but (deliberately, unlike Sound
// Design's Layers tab) offers no add/remove/reorder here, just picking
// which of the preset's existing layers to shape. Defaults to the first
// layer whenever the preset changes.
const selectedEnvLayerIndex = ref<number | null>(null)
watch(currentPreset, (preset) => {
  selectedEnvLayerIndex.value = preset && preset.layers.length > 0 ? 0 : null
}, { immediate: true })
const selectedEnvLayer = computed(() => {
  if (!currentPreset.value || selectedEnvLayerIndex.value === null) return null
  return currentPreset.value.layers[selectedEnvLayerIndex.value] ?? null
})

const saving = ref(false)
const savedFlash = ref(false)

function selectPreset(bankProg: string) {
  setPreset(bankProg)
  lastPerformancePresetKey.value = bankProg
  if (currentBank.value) logPatchMapping(currentBank.value, bankProg)
}

// FX/patch-level Modulation are optional/lazily-seeded Preset fields (see
// core/audio/types.ts) -- seed blanks so the Center/Right panes below
// always have something to bind to, whichever preset ends up loaded
// (including static banks like Orbit-3, which never had these authored --
// edits there just never have anywhere to Save to, same as any other
// static-bank edit today).
watch(currentPreset, (preset) => {
  if (!preset) return
  preset.fx ??= blankFxChain()
  preset.modMatrix ??= []
  preset.lfo1 ??= blankLfo()
  preset.lfo2 ??= blankLfo()
}, { immediate: true })

async function save() {
  if (!isCurrentBankSaveable.value || saving.value) return
  saving.value = true
  try {
    await persistCurrentBank()
    savedFlash.value = true
    setTimeout(() => { savedFlash.value = false }, 1500)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  if (!currentBank.value || !currentBankId.value) return
  AudioEngine.loadBank(currentBank.value, currentBankId.value)
  const presetKeys = Object.keys(currentBank.value.presets).sort()
  const restoreKey = lastPerformancePresetKey.value && currentBank.value.presets[lastPerformancePresetKey.value]
    ? lastPerformancePresetKey.value
    : presetKeys[0]
  if (restoreKey) selectPreset(restoreKey)
})
</script>

<template>
  <template v-if="currentBank">
    <div class="flex flex-row gap-2 items-start w-full">
      <div class="flex flex-col gap-2 shrink-0">
        <PresetBrowser :bank="currentBank" :active-bank-prog="currentBankProg" @select="selectPreset" />
      </div>

      <div v-if="currentPreset" class="flex flex-col gap-2 flex-1 min-w-0">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap gap-1">
            <button
              class="sd-btn inline-flex font-mono items-center gap-1.5"
              :class="activeTab === 'filter' ? 'sd-btn-primary' : ''"
              @click="activeTab = 'filter'"
            >
              <Funnel :size="14" /> Filter
            </button>
            <button
              class="sd-btn inline-flex font-mono items-center gap-1.5"
              :class="activeTab === 'fx' ? 'sd-btn-primary' : ''"
              @click="activeTab = 'fx'"
            >
              <Blend :size="14" /> FX
            </button>
            <button
              class="sd-btn inline-flex font-mono items-center gap-1.5"
              :class="activeTab === 'envelope' ? 'sd-btn-primary' : ''"
              @click="activeTab = 'envelope'"
            >
              <Activity :size="14" /> Envelope
            </button>
            <button
              class="sd-btn inline-flex font-mono items-center gap-1.5"
              :class="activeTab === 'modulation' ? 'sd-btn-primary' : ''"
              @click="activeTab = 'modulation'"
            >
              <Share2 :size="14" /> Modulation
            </button>
            
            
          </div>
          <button
            class="sd-btn inline-flex items-center gap-1"
            :class="savedFlash ? 'sd-btn-primary' : ''"
            :disabled="!isCurrentBankSaveable || saving"
            :title="isCurrentBankSaveable ? 'Save this preset\'s FX/Modulation/Filter/Envelope edits back to the bank' : 'Only user banks can be saved -- this is a static (built-in) bank'"
            @click="save"
          >
            <Save :size="14" /> {{ savedFlash ? 'Saved' : 'Save' }}
          </button>
        </div>

        <FxChainEditor v-if="activeTab === 'fx' && currentPreset.fx" :chain="currentPreset.fx" learn-scope="performance" />

        <template v-else-if="activeTab === 'modulation'">
          <label class="flex items-center gap-2 text-xs sd-panel py-2 mb-2 w-fit">
            <input
              :checked="currentPreset.modMatrixBypassed === false"
              type="checkbox"
              @change="currentPreset.modMatrixBypassed = ($event.target as HTMLInputElement).checked ? false : true"
            />
            Enable each layer's own Mod Matrix (off by default -- routings parsed from the original bank's hardware data were calibrated for a filter/routing model this app doesn't emulate, and some audibly wreck playback here. Doesn't affect the panel below, which is always your own routings.)
          </label>
          <ModulationEditor :preset="currentPreset" />
        </template>

        <FilterPanel v-else-if="activeTab === 'filter'" :preset="currentPreset" />

        <template v-else-if="activeTab === 'envelope'">
          <div v-if="currentPreset.layers.length > 0" class="flex flex-col gap-2">
            <label class="flex items-center gap-2 text-xs">
              <span style="color: var(--color-ink-soft)">Layer</span>
              <select v-model.number="selectedEnvLayerIndex" class="sd-input text-xs">
                <option v-for="(layer, i) in currentPreset.layers" :key="i" :value="i">Layer {{ i }} &middot; {{ layer.zones.length }} zone(s)</option>
              </select>
            </label>
            <EnvelopeScopeEditor v-if="selectedEnvLayer" :layer="selectedEnvLayer" :preset="currentPreset" kind="amp" title="Amp Envelope" />
          </div>
          <p v-else class="text-sm px-2 py-4" style="color: var(--color-ink-soft)">This preset has no layers.</p>
        </template>
      </div>
    </div>

    <VoiceActivityView />
    <VirtualKeyboard />
  </template>
</template>
