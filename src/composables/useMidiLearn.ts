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
import { applyMidiParam } from './useMidiParamRouter'

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
      if (cc !== controller) continue
      const value01 = value / 127
      // Two independent appliers, both idempotent writes to the same
      // target field so firing both is harmless: valueCallbacks drives a
      // mounted Dial's own v-model (and its visual position) for every
      // learnId; applyMidiParam additionally drives the small set of
      // app-level performance params (see useMidiParamRouter.ts) whether
      // or not their Dial is currently mounted.
      valueCallbacks.get(id)?.(value01)
      applyMidiParam(id, value01)
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
    // Dial.vue registers itself (on mount) so an incoming CC on its bound
    // channel can update its own v-model -- and deliberately stays
    // registered after unmount (see Dial.vue's comment), so a binding keeps
    // working while its dial is off-screen (a different tab, a collapsed
    // node, a preset not currently showing), matching real MIDI Learn
    // behavior. Re-mounting the same learnId just overwrites this entry.
    registerCallback(id: string, cb: (value01: number) => void) {
      valueCallbacks.set(id, cb)
    },
    // Not called by Dial.vue itself (see above) -- available for a caller
    // that knows a learnId's target was genuinely deleted (e.g. an FX node
    // removed from its chain) and wants to drop the stale registration
    // immediately rather than letting it linger harmlessly for the rest of
    // the session.
    unregisterCallback(id: string) {
      valueCallbacks.delete(id)
    },
  }
}
