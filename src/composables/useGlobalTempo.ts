// Global BPM for patch-level LFO tempo-sync (Preset.lfo1/lfo2 with
// rateMode === 'sync') -- the app has no transport/sequencer concept
// (TransportBar.vue was removed), so this is a plain app-wide value, not
// per-preset/bank data, same persistence shape as useGlobalFx.ts.
import { ref, watch } from 'vue'
import { AudioEngine } from '../core/audio/AudioEngine'

const STORAGE_KEY = 'emulatorx3.globalTempo'
const DEFAULT_BPM = 120
const MIN_BPM = 20
const MAX_BPM = 300

function clamp(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Number.isFinite(bpm) ? bpm : DEFAULT_BPM))
}

function loadBpm(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return clamp(Number(raw))
  } catch {
    // corrupt/unavailable storage -- fall through to the default
  }
  return DEFAULT_BPM
}

const bpm = ref<number>(loadBpm())

watch(bpm, (next) => {
  const clamped = clamp(next)
  AudioEngine.setGlobalTempo(clamped)
  try {
    localStorage.setItem(STORAGE_KEY, String(clamped))
  } catch {
    // storage unavailable (private browsing, quota) -- non-fatal
  }
}, { immediate: true })

export function useGlobalTempo() {
  return { bpm, MIN_BPM, MAX_BPM }
}
