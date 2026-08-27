// Global/Aux FX: plain module-level singleton (matches useMidiLearn.ts's
// pattern), persisted to localStorage rather than bank/preset data --
// real Emulator X3's Aux FX lives at the Multisetup level, applying across
// all MIDI channels; this app has no multi-channel concept, so it maps
// onto "one app-wide chain, independent of whichever preset is loaded,
// surviving reloads" instead of per-bank data. See core/audio/effects.ts
// and docs/ARCHITECTURE.md.
import { ref, watch } from 'vue'
import { AudioEngine } from '../core/audio/AudioEngine'
import { blankFxChain, type FxChain } from '../core/audio/effects'

const STORAGE_KEY = 'emulatorx3.globalFx'

function loadConfig(): FxChain {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as FxChain
  } catch {
    // corrupt/unavailable storage -- fall through to a blank config
  }
  return blankFxChain()
}

const config = ref<FxChain>(loadConfig())

watch(config, (next) => {
  AudioEngine.setGlobalFx(next)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable (private browsing, quota) -- non-fatal, just
    // won't persist across reloads
  }
}, { deep: true, immediate: true })

export function useGlobalFx() {
  return { config }
}
