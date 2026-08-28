// Applies a Layer's/Preset's modMatrix[] to a Voice's already-built
// Tone.js node graph. See docs/ARCHITECTURE.md §3 and
// docs/plans/Modulation-Plan.md for the full routing table.
//
// One documented v1 gap with no equivalent at all, live or one-time
// (logged-once-and-skipped rather than faked): destination "volEnvDecay"
// -- Tone.Envelope.decay is a scheduling parameter, not automatable, and
// there's no other hook to bake a one-time bias into the way `pitch`
// below gets one.
//
// `pitch` is NOT live-modulatable (Tone.Player.playbackRate is a plain
// number setter, not a connectable Tone.Param/AudioParam, so it can't be
// swept by an LFO/envelope the way filter.frequency can), but unlike
// volEnvDecay it DOES support one-time-at-note-on modulation -- see
// ONE_TIME_ONLY_DESTINATIONS/computeEnvelopeAndStartOverrides() below,
// applied in Voice.ts's applyPitch() alongside transpose/fine-tune/
// pitch-bend, all of which were already one-time/static for the same
// reason.
import * as Tone from 'tone'
import type { ModMatrixSlot, CustomMidiSource } from './types'
import type { EffectChain } from './effects'
import { lfoDelayByteToSeconds, lfoVariationByteToDepth } from './lfoMapping'

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
  // 0-127 bytes from the active preset's Preset.lfo1/lfo2 -- see
  // wrapPatchLfoSource() below. Read fresh per voice (not live-updatable
  // mid-note, same scope as the LFO's rate/shape).
  patchLfo1Delay: number
  patchLfo1Variation: number
  patchLfo2Delay: number
  patchLfo2Variation: number
  // Per-node bypass toggle (Lfo.bypass, ModulationEditor.vue) -- when true,
  // this LFO's routings are skipped entirely (no modulation, no warning --
  // a valid, temporarily-inactive cable, same as an FX node's bypass).
  patchLfo1Bypassed: boolean
  patchLfo2Bypassed: boolean
  // Final pan/output-level nodes in Voice's chain -- targets for the
  // `ampPan`/`ampVolume` destinations (docs/plans/Modulation-Plan.md).
  panner: Tone.Panner
  outGain: Tone.Gain
  // Live mirror of this voice's glide rate (Voice.ts's glideRateSignal) --
  // undefined when this voice wasn't built with an active glide (Preset.
  // glide disabled, or the very first note played with nothing to glide
  // from). The manual playbackRate ramp in Voice.ts's startGlide() reads
  // this signal's value every tick, so modulating it live actually changes
  // an in-progress glide's speed, not just the next one's.
  glideRate: Tone.Signal<'positive'> | undefined
  // Preset.customMidiSources -- resolves a `custom:<id>` slot.source to a
  // live CC signal, same underlying mechanism as the per-slot `midiCC`
  // override, just named/reusable. See resolveLiveSource() below.
  customSources: CustomMidiSource[]
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
  // Each live destination's true "no modulation" baseline, snapshotted
  // ONCE in Voice.ts before any modMatrix connections are made (before
  // either applyModMatrix() call below) -- required because connecting a
  // Tone.Scale/Signal to a Tone.Param resets that param's value to 0 at
  // connect time (Tone.js's `connectSignal()`, not a plain additive Web
  // Audio AudioNode->AudioParam connection), so re-reading `.value` after
  // any cable has already connected would incorrectly read back 0. See
  // baseFor() below.
  baseValues: {
    filterFreq: number
    filterQ: number
    ampVolume: number
    ampPan: number
    lfo1Rate: number
    lfo2Rate: number
    patchLfo1Rate: number
    patchLfo2Rate: number
    wetDryMix: number
    glideRate: number
  }
  // Destinations whose baseline has already been folded into a cable's
  // Scale this voice -- only the FIRST cable to a given destination
  // encodes the baseline; further cables to the SAME destination use a
  // zero baseline (pure deltas), since the native AudioParam already sums
  // every connected Scale -- encoding the baseline into more than one
  // would double/triple-count it. Shared across both applyModMatrix()
  // calls (layer then preset) via the same `targets` object -- see
  // baseFor() below.
  basedDestinations: Set<string>
  disposables: Array<{ dispose: () => void }>
}

/** Returns the baseline to fold into this cable's Scale for `destination`
 * -- the real snapshotted value for the first cable routed there this
 * voice, zero for every subsequent one. See ModMatrixTargets.baseValues'
 * doc comment for why this exists at all. */
function baseFor(destination: keyof ModMatrixTargets['baseValues'], targets: ModMatrixTargets): number {
  if (targets.basedDestinations.has(destination)) return 0
  targets.basedDestinations.add(destination)
  return targets.baseValues[destination]
}

// `volEnvDecay` alone stays here: no live AudioParam equivalent exists at
// all (Tone.Envelope.decay is a scheduling parameter, not automatable),
// not even a one-time-at-note-on approximation the way `pitch` gets below.
const UNSUPPORTED_LIVE_DESTINATIONS = new Set(['volEnvDecay'])
// Handled by computeEnvelopeAndStartOverrides() before the envelope/player
// are constructed (Voice.build()), not by this file's live-connection
// switch below -- Tone.js envelope segment times aren't live AudioParams,
// a Player's start offset can't change after playback begins, and
// Tone.Player.playbackRate is a plain number setter (not a connectable
// Tone.Param) -- so these are one-time-at-note-on only, sampled from
// whatever source's *current* value is at the moment the voice is
// triggered. See docs/plans/Modulation-Plan.md.
const ONE_TIME_ONLY_DESTINATIONS = new Set(['envAttack', 'envDecay', 'envSustain', 'envRelease', 'sampleStart', 'pitch'])

const warnedOnce = new Set<string>()
function warnUnhandled(source: string, destination: string) {
  const key = `${source}->${destination}`
  if (warnedOnce.has(key)) return
  warnedOnce.add(key)
  console.warn(`[modMatrix] unhandled routing "${key}" -- voice will play unmodulated for this slot`)
}

const FILTER_FREQ_MOD_RANGE_HZ = 4000 // +/- range a full-depth mod can sweep the cutoff
const AMP_VOLUME_MOD_RANGE = 1.0 // +/- linear gain a full-depth mod can add/subtract onto outGain
const AMP_PAN_MOD_RANGE = 1.0 // +/- pan a full-depth mod can add/subtract (Tone.Panner clamps -1..1 internally)
const GLIDE_RATE_MOD_RANGE = 64 // +/- half the 0-127 dial range a full-depth mod can shift glide rate by

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

    // Not unhandled -- computeEnvelopeAndStartOverrides() already applied
    // these before this voice's envelope/player were built. Skip silently
    // (no warnUnhandled) so a routing to one of these destinations doesn't
    // spam a "unhandled" warning for a destination that IS handled, just
    // earlier in the sequence than this loop.
    if (ONE_TIME_ONLY_DESTINATIONS.has(slot.destination)) continue

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
    let sourceSignal: Tone.ToneAudioNode | Tone.Signal<any> | undefined =
      slot.midiCC != null ? targets.getCCSignal(slot.midiCC) : resolveLiveSource(slot.source, targets)
    if (!sourceSignal) {
      warnUnhandled(slot.source, slot.destination)
      continue
    }

    // A bypassed patch LFO contributes no modulation at all -- a valid,
    // temporarily-inactive cable, not an error, so no warnUnhandled (same
    // semantics as an FX node's bypass toggle).
    if (slot.midiCC == null && slot.source === 'patchLfo1' && targets.patchLfo1Bypassed) continue
    if (slot.midiCC == null && slot.source === 'patchLfo2' && targets.patchLfo2Bypassed) continue

    // Patch-level LFO Delay/Variation (Preset.lfo1/lfo2) apply per-voice,
    // wrapping the shared oscillator rather than mutating it -- see
    // wrapPatchLfoSource()'s header comment.
    if (slot.midiCC == null && slot.source === 'patchLfo1') {
      sourceSignal = wrapPatchLfoSource(targets.patchLfo1, targets.patchLfo1Delay, targets.patchLfo1Variation, targets.disposables)
    } else if (slot.midiCC == null && slot.source === 'patchLfo2') {
      sourceSignal = wrapPatchLfoSource(targets.patchLfo2, targets.patchLfo2Delay, targets.patchLfo2Variation, targets.disposables)
    }

    if ((slot.destination === 'filterFreq' || slot.destination === 'filterQ') && !targets.filter) {
      warnUnhandled(slot.source, slot.destination)
      continue
    }

    // Every case below centers its Scale on `base` (this destination's
    // real pre-modulation value, see baseFor()/ModMatrixTargets.baseValues)
    // rather than 0 -- connecting a Scale to a Tone.Param resets that
    // param's own value to 0 at connect time (Tone.js's `connectSignal()`,
    // not a plain additive AudioNode->AudioParam connection), so without
    // this the destination's dialed-in value would be silently wiped the
    // instant a cable connects, before `depth` even matters. This was the
    // root cause of "connect an LFO to Amp Volume -> total silence" (base
    // gain reset to 0, then governed only by a possibly-still-0%-depth
    // cable) and, more subtly, the same class of bug the original
    // filterQ comment below was written around (a scale floored at literal
    // 0 could still walk Q back through the self-silencing near-zero
    // region -- flooring at the *real* base Q instead closes that gap for
    // real, rather than just narrowing the odds of hitting it).
    switch (slot.destination) {
      case 'filterFreq': {
        const base = baseFor('filterFreq', targets)
        const scale = new Tone.Scale(base, base + depth * FILTER_FREQ_MOD_RANGE_HZ)
        sourceSignal.connect(scale)
        scale.connect(targets.filter!.frequency)
        targets.disposables.push(scale)
        break
      }
      case 'filterQ': {
        // Always modulating upward from the real base Q (abs depth) --
        // same deliberate direction tradeoff as before, now anchored on
        // the actual dialed-in resonance instead of a hardcoded 0 floor.
        const base = baseFor('filterQ', targets)
        const scale = new Tone.Scale(base, base + Math.abs(depth) * 20)
        sourceSignal.connect(scale)
        scale.connect(targets.filter!.Q)
        targets.disposables.push(scale)
        break
      }
      case 'lfo1Rate': {
        const base = baseFor('lfo1Rate', targets)
        const scale = new Tone.Scale(base, base + depth * 10)
        sourceSignal.connect(scale)
        scale.connect(targets.lfo1.frequency)
        targets.disposables.push(scale)
        break
      }
      case 'lfo2Rate': {
        const base = baseFor('lfo2Rate', targets)
        const scale = new Tone.Scale(base, base + depth * 10)
        sourceSignal.connect(scale)
        scale.connect(targets.lfo2.frequency)
        targets.disposables.push(scale)
        break
      }
      case 'patchLfo1Rate': {
        // Targets the shared patch-level LFO (Preset.lfo1), NOT the
        // per-layer `lfo1Rate` above -- see docs/plans/Modulation-Plan.md.
        const base = baseFor('patchLfo1Rate', targets)
        const scale = new Tone.Scale(base, base + depth * 10)
        sourceSignal.connect(scale)
        scale.connect(targets.patchLfo1.frequency)
        targets.disposables.push(scale)
        break
      }
      case 'patchLfo2Rate': {
        const base = baseFor('patchLfo2Rate', targets)
        const scale = new Tone.Scale(base, base + depth * 10)
        sourceSignal.connect(scale)
        scale.connect(targets.patchLfo2.frequency)
        targets.disposables.push(scale)
        break
      }
      case 'ampVolume': {
        const base = baseFor('ampVolume', targets)
        const scale = new Tone.Scale(base, base + depth * AMP_VOLUME_MOD_RANGE)
        sourceSignal.connect(scale)
        scale.connect(targets.outGain.gain)
        targets.disposables.push(scale)
        break
      }
      case 'ampPan': {
        const base = baseFor('ampPan', targets)
        const scale = new Tone.Scale(base, base + depth * AMP_PAN_MOD_RANGE)
        sourceSignal.connect(scale)
        scale.connect(targets.panner.pan)
        targets.disposables.push(scale)
        break
      }
      case 'wetDryMix': {
        const base = baseFor('wetDryMix', targets)
        const scale = new Tone.Scale(base, base + depth)
        sourceSignal.connect(scale)
        scale.connect(targets.fxChain.wetDryFade)
        targets.disposables.push(scale)
        break
      }
      case 'glideRate': {
        if (!targets.glideRate) { warnUnhandled(slot.source, slot.destination); break }
        const base = baseFor('glideRate', targets)
        const scale = new Tone.Scale(base, base + depth * GLIDE_RATE_MOD_RANGE)
        sourceSignal.connect(scale)
        scale.connect(targets.glideRate)
        targets.disposables.push(scale)
        break
      }
      default:
        warnUnhandled(slot.source, slot.destination)
    }
  }
}

/** Wraps a shared patch-level LFO (patchLfo1/patchLfo2 -- one instance per
 * active preset, running continuously across every held note) with a
 * per-voice delay-ramp and randomized depth multiplier, so Delay/Variation
 * behave per-note even though the oscillator itself is shared and never
 * re-triggered. Mutating the shared oscillator's own rate/phase per note
 * would detune/reset it for every other currently-held note using it --
 * this wraps the *routing*, not the source, instead. Both stages are
 * cheap constant-value Tone.Gain nodes, disposed with the rest of this
 * voice's mod-matrix nodes. */
function wrapPatchLfoSource(base: Tone.LFO, delayByte: number, variationByte: number, disposables: Array<{ dispose: () => void }>): Tone.ToneAudioNode {
  const delaySec = lfoDelayByteToSeconds(delayByte)
  const variationDepth = lfoVariationByteToDepth(variationByte)
  if (delaySec <= 0 && variationDepth <= 0) return base

  const ramp = new Tone.Gain(delaySec > 0 ? 0 : 1)
  if (delaySec > 0) ramp.gain.linearRampTo(1, delaySec, Tone.now())
  disposables.push(ramp)

  const variationMultiplier = variationDepth > 0 ? 1 + (Math.random() * 2 - 1) * variationDepth : 1
  const variationGain = new Tone.Gain(variationMultiplier)
  disposables.push(variationGain)

  base.connect(ramp)
  ramp.connect(variationGain)
  return variationGain
}

function resolveLiveSource(source: string, targets: ModMatrixTargets): Tone.ToneAudioNode | Tone.Signal<any> | undefined {
  if (source.startsWith('custom:')) {
    const id = source.slice('custom:'.length)
    const custom = targets.customSources.find((s) => s.id === id)
    return custom ? targets.getCCSignal(custom.cc) : undefined
  }
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

// -- Envelope/sample-start one-time overrides ---------------------------
// Computed once, before Voice.build() constructs its Tone.AmplitudeEnvelope
// / Tone.Envelope / calls player.start() -- see ONE_TIME_ONLY_DESTINATIONS
// above. Deliberately a wider source set than applyOneTimeSource()'s
// velocity/key-only scope: any source with a synchronously-readable
// "current value" at the instant a voice is triggered works here
// (velocity, key, modWheel, pressure, pitchWheel, gate, any custom-CC/
// midiCC-override signal). patchLfo1/patchLfo2 (a running oscillator's
// instantaneous phase isn't a well-defined "current value" the way a
// Tone.Signal's `.value` is) and filterEnv/lfo1Bipolar/lfo2Bipolar
// (per-voice nodes that don't exist yet at this point in construction)
// are unsupported for these destinations specifically -- logged once,
// skipped, same as any other unresolvable routing.
export interface OneTimeSourceContext {
  velocity01: number
  key01: number
  modWheelSignal: Tone.Signal<'normalRange'>
  pitchWheelSignal: Tone.Signal<'audioRange'>
  pressureSignal: Tone.Signal<'normalRange'>
  getCCSignal: (cc: number) => Tone.Signal<'normalRange'>
  customSources: CustomMidiSource[]
}

export interface EnvelopeAndStartOverrides {
  attackDeltaSec: number
  decayDeltaSec: number
  sustainDeltaNorm: number
  releaseDeltaSec: number
  sampleStartFrac: number // 0..1 fraction of the sample's duration, pre-clamp
  pitchDeltaSemitones: number
}

const ENV_TIME_MOD_RANGE_SEC = 2 // a full-depth mod can shift attack/decay/release by up to +/-2s
const PITCH_MOD_RANGE_SEMITONES = 12 // a full-depth mod can shift static pitch by up to +/-1 octave

function resolveOneTimeValue(source: string, midiCC: number | null, ctx: OneTimeSourceContext): number | null {
  if (midiCC != null) return ctx.getCCSignal(midiCC).value as number
  if (source.startsWith('custom:')) {
    const custom = ctx.customSources.find((s) => s.id === source.slice('custom:'.length))
    return custom ? (ctx.getCCSignal(custom.cc).value as number) : null
  }
  switch (source) {
    case 'velocity': return ctx.velocity01
    case 'key': return ctx.key01
    case 'modWheel': return ctx.modWheelSignal.value as number
    case 'pressure': return ctx.pressureSignal.value as number
    case 'pitchWheel': return ctx.pitchWheelSignal.value as number // bipolar -1..1, used as-is
    case 'gate': return 1 // always full at the instant a voice is constructed, before any release
    default: return null // patchLfo1/2, filterEnv, lfo1/2Bipolar/Unipolar -- see header comment
  }
}

/** Scans `slots` for ONE_TIME_ONLY_DESTINATIONS routings and sums their
 * contribution into deltas Voice.build() applies before constructing its
 * envelopes/starting playback -- see the header comment above. Multiple
 * routings to the same destination sum, consistent with how multiple
 * live routings to one destination already combine (Web Audio auto-sums
 * multiple `.connect()`s onto one AudioParam). */
export function computeEnvelopeAndStartOverrides(slots: ModMatrixSlot[], ctx: OneTimeSourceContext): EnvelopeAndStartOverrides {
  const result: EnvelopeAndStartOverrides = { attackDeltaSec: 0, decayDeltaSec: 0, sustainDeltaNorm: 0, releaseDeltaSec: 0, sampleStartFrac: 0, pitchDeltaSemitones: 0 }
  for (const slot of slots) {
    if (!ONE_TIME_ONLY_DESTINATIONS.has(slot.destination)) continue
    const depth = slot.amountPct / 100
    if (!Number.isFinite(depth)) { warnUnhandled(slot.source, slot.destination); continue }
    const value = resolveOneTimeValue(slot.source, slot.midiCC, ctx)
    if (value == null || !Number.isFinite(value)) { warnUnhandled(slot.source, slot.destination); continue }
    switch (slot.destination) {
      case 'envAttack': result.attackDeltaSec += depth * value * ENV_TIME_MOD_RANGE_SEC; break
      case 'envDecay': result.decayDeltaSec += depth * value * ENV_TIME_MOD_RANGE_SEC; break
      case 'envRelease': result.releaseDeltaSec += depth * value * ENV_TIME_MOD_RANGE_SEC; break
      case 'envSustain': result.sustainDeltaNorm += depth * value; break
      case 'sampleStart': result.sampleStartFrac += Math.abs(depth) * Math.abs(value); break
      case 'pitch': result.pitchDeltaSemitones += depth * value * PITCH_MOD_RANGE_SEMITONES; break
    }
  }
  return result
}
