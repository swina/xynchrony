// Plain reactive singleton wrapping core/audio/AudioEngine.ts (no Pinia --
// see docs/ARCHITECTURE.md). AudioEngine itself has no event emitter, so
// activeVoiceCount is polled at a coarse interval -- cheap (a Set.size
// read) and only needs to be UI-refresh-rate accurate, not audio-accurate.
import { ref, watch } from 'vue'
import { AudioEngine } from '../core/audio/AudioEngine'
import { useGlobalFx } from './useGlobalFx'
import type { Preset } from '../core/audio/types'

// Browsers require a user gesture before an AudioContext can start, so this
// can't force-start audio on load -- but it lets App.vue attempt a silent
// auto-resume for a returning visitor (succeeds in browsers that grant it
// based on prior engagement, no-ops otherwise, in which case the "Enable
// audio" button still shows as normal).
const AUDIO_ENABLED_KEY = 'emulatorx3.audioEnabled'

function loadPreviouslyEnabled(): boolean {
  try {
    return localStorage.getItem(AUDIO_ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

const previouslyEnabled = loadPreviouslyEnabled()

const started = ref(false)
const masterVolume = ref(0.8)
const activeVoiceCount = ref(0)
const heldNotes = ref<number[]>([])
const meterLevel = ref(0)
const currentPreset = ref<Preset | null>(null)
const currentBankProg = ref<string | null>(null)

let pollHandle: ReturnType<typeof setInterval> | null = null

function startPolling() {
  if (pollHandle) return
  pollHandle = setInterval(() => {
    activeVoiceCount.value = AudioEngine.activeVoiceCount
    heldNotes.value = AudioEngine.heldNotes
    meterLevel.value = AudioEngine.getMeterLevel()
  }, 100)
}

async function ensureStarted() {
  if (started.value) return
  await AudioEngine.start()
  AudioEngine.setMasterVolume(masterVolume.value)
  // start() builds a fresh (blank) Global FX chain -- push the persisted
  // config into it now that it actually exists. See useGlobalFx.ts.
  AudioEngine.setGlobalFx(useGlobalFx().config.value)
  started.value = true
  startPolling()
  try {
    localStorage.setItem(AUDIO_ENABLED_KEY, '1')
  } catch {
    // Storage unavailable (private browsing, quota) -- just means next
    // visit shows the "Enable audio" button again, not a functional problem.
  }
}

function setPreset(bankProg: string) {
  AudioEngine.setPreset(bankProg)
  currentBankProg.value = bankProg
  currentPreset.value = AudioEngine.currentPreset
}

// currentPreset.value is the SAME reactive object every FX/Modulation
// editor mutates in place (Performance mode's FX/Modulation panes, Sound
// Design's FX tab -- all bind directly to currentPreset.fx/modMatrix/lfo1/
// lfo2, no separate "apply" step, matching this app's mutate-in-place
// pattern everywhere else). deep:true is what picks up those field-level
// edits; setPreset() above already rebuilds fx on a preset switch, so the
// redundant rebuild this triggers on identity change too is harmless
// (rebuild() is an editing-time op, not a hot path -- see effects.ts). This
// only keeps the live audio graph in sync -- it never persists anything;
// see docs/plans/FX-Modulations.md's Decision 2 for the separate, explicit
// Save action that does.
watch(currentPreset, () => {
  AudioEngine.refreshPresetLive()
}, { deep: true })

function setMasterVolume(value01: number) {
  masterVolume.value = value01
  AudioEngine.setMasterVolume(value01)
}

function panic() {
  AudioEngine.panic()
}

export function useAudioEngine() {
  return {
    started,
    previouslyEnabled,
    masterVolume,
    activeVoiceCount,
    heldNotes,
    meterLevel,
    currentPreset,
    currentBankProg,
    ensureStarted,
    setPreset,
    setMasterVolume,
    panic,
    noteOn: AudioEngine.noteOn.bind(AudioEngine),
    noteOff: AudioEngine.noteOff.bind(AudioEngine),
  }
}
