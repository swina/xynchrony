// MIDI Learn engine for Dial.vue. Plain reactive singleton (no Pinia --
// same pattern as useMidiInput.ts/useAudioEngine.ts). Bindings are keyed by
// a dial's stable `learnId` (a role, e.g. "sd:layer:cutoff") rather than by
// which layer/preset happens to be selected, so learning a physical
// controller knob to a UI dial once keeps working no matter what data that
// dial is currently pointed at -- matching how MIDI Learn behaves on real
// hardware/DAWs. Requires MidiInput to already be initialized (TopBar
// does this); this module only listens, it never requests MIDI access
// itself, so it doesn't double-prompt for permission.
import { ref } from 'vue'
import { MidiInput } from '../core/midi/MidiInput'

const STORAGE_KEY = 'emulatorx3.midiLearnBindings'

function loadBindings(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

const bindings = ref<Record<string, number>>(loadBindings())
const learningId = ref<string | null>(null)
const valueCallbacks = new Map<string, (value01: number) => void>()

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings.value))
}

let listening = false
function ensureListening() {
  if (listening) return
  listening = true
  MidiInput.onControlChange((controller, value) => {
    if (learningId.value) {
      bindings.value = { ...bindings.value, [learningId.value]: controller }
      persist()
      learningId.value = null
      return
    }
    for (const [id, cc] of Object.entries(bindings.value)) {
      if (cc === controller) valueCallbacks.get(id)?.(value / 127)
    }
  })
}

export function useMidiLearn() {
  ensureListening()

  return {
    bindings,
    learningId,
    startLearn(id: string) {
      learningId.value = id
    },
    cancelLearn() {
      if (learningId.value !== null) learningId.value = null
    },
    clearBinding(id: string) {
      if (!(id in bindings.value)) return
      const next = { ...bindings.value }
      delete next[id]
      bindings.value = next
      persist()
    },
    // Dial.vue registers itself so an incoming CC on its bound channel can
    // update its own v-model; unregistered on unmount to avoid updating a
    // dial that's no longer on screen.
    registerCallback(id: string, cb: (value01: number) => void) {
      valueCallbacks.set(id, cb)
    },
    unregisterCallback(id: string) {
      valueCallbacks.delete(id)
    },
  }
}
