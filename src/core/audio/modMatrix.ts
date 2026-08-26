// Applies a Layer's modMatrix[] to a Voice's already-built Tone.js node
// graph. See docs/ARCHITECTURE.md §3 for the routing table.
//
// Two documented v1 gaps, both logged-once-and-skipped rather than faked:
//   - destination "volEnvDecay": no live AudioParam equivalent in Tone.js
//     (Tone.Envelope.decay is a scheduling parameter, not automatable).
//   - destination "pitch": Tone.Player.playbackRate is a plain number
//     setter, not a connectable Tone.Param/AudioParam, so it can't be
//     live-modulated by an LFO/envelope the way filter.frequency can.
//     Static pitch (note/rootKey/transpose/fineTune/pitch-bend) is still
//     fully applied in Voice.ts -- only *modulated* pitch is the gap.
import * as Tone from 'tone'
import type { ModMatrixSlot } from './types'

export interface ModMatrixTargets {
  player: Tone.Player
  filter: Tone.Filter
  filterEnv: Tone.Envelope
  lfo1: Tone.LFO
  lfo2: Tone.LFO
  modWheelSignal: Tone.Signal<'normalRange'>
  getCCSignal: (cc: number) => Tone.Signal<'normalRange'>
  velocity01: number // resolved once at note-on, 0..1
  disposables: Array<{ dispose: () => void }>
}

const UNSUPPORTED_LIVE_DESTINATIONS = new Set(['volEnvDecay', 'pitch'])

const warnedOnce = new Set<string>()
function warnUnhandled(source: string, destination: string) {
  const key = `${source}->${destination}`
  if (warnedOnce.has(key)) return
  warnedOnce.add(key)
  console.warn(`[modMatrix] unhandled routing "${key}" -- voice will play unmodulated for this slot`)
}

const FILTER_FREQ_MOD_RANGE_HZ = 4000 // +/- range a full-depth mod can sweep the cutoff

export function applyModMatrix(slots: ModMatrixSlot[], targets: ModMatrixTargets): void {
  for (const slot of slots) {
    const depth = slot.amountPct / 100 // -1..1

    if (UNSUPPORTED_LIVE_DESTINATIONS.has(slot.destination)) {
      warnUnhandled(slot.source, slot.destination)
      continue
    }

    if (slot.midiCC == null && slot.source === 'velocity') {
      // Velocity is resolved once at note-on, not a live signal. Applied
      // as a one-time offset baked into the initial param value.
      applyVelocityOnce(slot.destination, depth, targets)
      continue
    }

    // A custom MIDI CC (set via the Mod Matrix UI's "CC" field) is a
    // continuous live source that overrides the enum-based `source` --
    // see docs/plans/sound-design-ui.md and VoiceManager.getCCSignal().
    const sourceSignal = slot.midiCC != null ? targets.getCCSignal(slot.midiCC) : resolveLiveSource(slot.source, targets)
    if (!sourceSignal) {
      warnUnhandled(slot.source, slot.destination)
      continue
    }

    switch (slot.destination) {
      case 'filterFreq': {
        const scale = new Tone.Scale(0, depth * FILTER_FREQ_MOD_RANGE_HZ)
        sourceSignal.connect(scale)
        scale.connect(targets.filter.frequency)
        targets.disposables.push(scale)
        break
      }
      case 'filterQ': {
        // Web Audio AudioParam connections are additive on top of the
        // node's base value (base Q floored at 0.707 -- see Voice.ts's
        // resonanceToQ()). A negative-depth slot here could otherwise
        // subtract enough to drive the *summed* Q back through the same
        // degenerate near-zero territory that caused the original
        // silent-preset bug, and there's no clean way to floor a sum of
        // independently-connected signals at the AudioParam level. Always
        // modulating upward (abs depth) sacrifices modulation direction
        // for this one destination, but that's the safe tradeoff --
        // deliberate simplification, not an oversight.
        const scale = new Tone.Scale(0, Math.abs(depth) * 20)
        sourceSignal.connect(scale)
        scale.connect(targets.filter.Q)
        targets.disposables.push(scale)
        break
      }
      case 'lfo1Rate': {
        const scale = new Tone.Scale(0, depth * 10)
        sourceSignal.connect(scale)
        scale.connect(targets.lfo1.frequency)
        targets.disposables.push(scale)
        break
      }
      case 'lfo2Rate': {
        const scale = new Tone.Scale(0, depth * 10)
        sourceSignal.connect(scale)
        scale.connect(targets.lfo2.frequency)
        targets.disposables.push(scale)
        break
      }
      default:
        warnUnhandled(slot.source, slot.destination)
    }
  }
}

function resolveLiveSource(source: string, targets: ModMatrixTargets): Tone.ToneAudioNode | Tone.Signal<any> | undefined {
  switch (source) {
    case 'filterEnv':
      return targets.filterEnv
    case 'lfo1Bipolar':
      return targets.lfo1
    case 'lfo2Bipolar':
      return targets.lfo2
    case 'modWheel':
      return targets.modWheelSignal
    // lfo1Unipolar/lfo2Unipolar/velocityDefault-as-source and any raw:0xNN
    // ID fall through to undefined -> logged once, skipped.
    default:
      return undefined
  }
}

function applyVelocityOnce(destination: string, depth: number, targets: ModMatrixTargets) {
  const v = targets.velocity01 // 0..1
  switch (destination) {
    case 'filterFreq': {
      const current = Number(targets.filter.frequency.value)
      targets.filter.frequency.value = Math.max(20, current + depth * v * FILTER_FREQ_MOD_RANGE_HZ)
      break
    }
    case 'filterQ': {
      // Floor at 0.707 (Butterworth/"flat"), not 0 -- Q=0 is a degenerate
      // value for the biquad filter's coefficient formula (1/(2*Q) term)
      // and silences the signal. See Voice.ts's resonanceToQ() for the
      // full story; this is the same class of bug, reachable via a
      // negative-depth velocity->filterQ routing.
      const current = Number(targets.filter.Q.value)
      targets.filter.Q.value = Math.max(0.707, current + depth * v * 20)
      break
    }
    default:
      warnUnhandled('velocity', destination)
  }
}
