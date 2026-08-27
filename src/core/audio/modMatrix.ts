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
import type { EffectChain } from './effects'

export interface ModMatrixTargets {
  player: Tone.Player
  // Undefined when the patch-level filter isn't in the chain for this voice
  // (Orbit-3/legacy presets -- see Voice.ts) -- filterFreq/filterQ
  // destinations and the filterEnv source are skipped (warnUnhandled) in
  // that case, same as any other unresolvable routing.
  filter: Tone.Filter | undefined
  filterEnv: Tone.Envelope | undefined
  lfo1: Tone.LFO
  lfo2: Tone.LFO
  // Shared, per-active-preset LFO pair (Preset.lfo1/lfo2, VoiceManager) --
  // sources for patch-level routings, distinct from the per-layer lfo1/lfo2
  // above. See docs/plans/FX-Modulations.md.
  patchLfo1: Tone.LFO
  patchLfo2: Tone.LFO
  modWheelSignal: Tone.Signal<'normalRange'>
  // Live per-voice sources added for the Manual.pdf p.156-160 catalog --
  // see docs/ARCHITECTURE.md. pitchWheel is bipolar (-1..1); gate/pressure
  // are 0..1.
  pitchWheelSignal: Tone.Signal<'audioRange'>
  gateSignal: Tone.Signal<'normalRange'>
  pressureSignal: Tone.Signal<'normalRange'>
  getCCSignal: (cc: number) => Tone.Signal<'normalRange'>
  velocity01: number // resolved once at note-on, 0..1
  key01: number // resolved once at note-on, 0..1 (note number / 127)
  // The active preset's Preset FX chain (core/audio/effects.ts) -- always
  // present (VoiceManager falls back to a fully-dry blankFxChain() when the
  // preset has none), so `wetDryMix` as a destination always has something
  // to connect to.
  fxChain: EffectChain
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
    if (!Number.isFinite(depth)) {
      // A NaN/undefined amountPct (malformed data from any source) must
      // never reach a Tone.Scale feeding an AudioParam -- unlike a one-time
      // value, a live audio-rate connection can't be clamped after the
      // fact, so this would permanently corrupt that destination for the
      // life of the voice. See Voice.ts's safeByte()/safeCutoffHz() for the
      // same concern on the construction-time path.
      warnUnhandled(slot.source, slot.destination)
      continue
    }

    if (UNSUPPORTED_LIVE_DESTINATIONS.has(slot.destination)) {
      warnUnhandled(slot.source, slot.destination)
      continue
    }

    if (slot.midiCC == null && (slot.source === 'velocity' || slot.source === 'key')) {
      // Velocity/Key are resolved once at note-on, not live signals.
      // Applied as a one-time offset baked into the initial param value.
      const value01 = slot.source === 'velocity' ? targets.velocity01 : targets.key01
      applyOneTimeSource(slot.source, value01, slot.destination, depth, targets)
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

    if ((slot.destination === 'filterFreq' || slot.destination === 'filterQ') && !targets.filter) {
      warnUnhandled(slot.source, slot.destination)
      continue
    }

    switch (slot.destination) {
      case 'filterFreq': {
        const scale = new Tone.Scale(0, depth * FILTER_FREQ_MOD_RANGE_HZ)
        sourceSignal.connect(scale)
        scale.connect(targets.filter!.frequency)
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
        scale.connect(targets.filter!.Q)
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
      case 'wetDryMix': {
        // fade is already 0..1 (rebuild() set the config's base value) --
        // depth scales directly, no Hz/Q-style range conversion needed.
        const scale = new Tone.Scale(0, depth)
        sourceSignal.connect(scale)
        scale.connect(targets.fxChain.wetDryFade)
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
    case 'patchLfo1':
      return targets.patchLfo1
    case 'patchLfo2':
      return targets.patchLfo2
    case 'modWheel':
      return targets.modWheelSignal
    case 'pitchWheel':
      return targets.pitchWheelSignal
    case 'gate':
      return targets.gateSignal
    case 'pressure':
      return targets.pressureSignal
    // lfo1Unipolar/lfo2Unipolar/velocityDefault-as-source and any raw:0xNN
    // ID fall through to undefined -> logged once, skipped.
    default:
      return undefined
  }
}

/** Velocity/Key are resolved once at note-on, not live signals -- applied
 * as a one-time offset baked into the initial param value. */
function applyOneTimeSource(sourceName: string, value01: number, destination: string, depth: number, targets: ModMatrixTargets) {
  if ((destination === 'filterFreq' || destination === 'filterQ') && !targets.filter) {
    warnUnhandled(sourceName, destination)
    return
  }
  switch (destination) {
    case 'filterFreq': {
      const current = Number(targets.filter!.frequency.value)
      targets.filter!.frequency.value = Math.max(20, current + depth * value01 * FILTER_FREQ_MOD_RANGE_HZ)
      break
    }
    case 'filterQ': {
      // Floor at 0.707 (Butterworth/"flat"), not 0 -- Q=0 is a degenerate
      // value for the biquad filter's coefficient formula (1/(2*Q) term)
      // and silences the signal. See Voice.ts's resonanceToQ() for the
      // full story; this is the same class of bug, reachable via a
      // negative-depth velocity/key->filterQ routing.
      const current = Number(targets.filter!.Q.value)
      targets.filter!.Q.value = Math.max(0.707, current + depth * value01 * 20)
      break
    }
    case 'wetDryMix': {
      const current = targets.fxChain.wetDryFade.value
      targets.fxChain.wetDryFade.value = Math.min(1, Math.max(0, current + depth * value01))
      break
    }
    default:
      warnUnhandled(sourceName, destination)
  }
}
