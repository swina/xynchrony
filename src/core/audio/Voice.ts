// One polyphonic sound-producing instance, spawned per matched Zone per
// note-on (see VoiceManager -- multiple Voices routinely sound together
// for one note-on, by design: docs/ARCHITECTURE.md §1.2 "true layering").
//
// Chain: Player -> Gain(ampEnv) -> [patch-level Filter, when preset.filter is set and not bypassed] -> Panner -> Gain(output) -> bus
import * as Tone from 'tone'
import type { Layer, Zone, Envelope, Preset } from './types'
import { applyModMatrix } from './modMatrix'
import { resolveAmpEnvelope } from '../soundDesign/envelopeScope'
import { lfoRateToHz, lfoShapeToType } from './lfoMapping'
import type { EffectChain } from './effects'
import type { SampleCache } from './SampleCache'

// A NaN/undefined byte value (malformed/partial data from any source --
// legacy schema, a lossy clone, hand-edited JSON) must never reach a
// Tone.js AudioParam: a single NaN there corrupts that node's internal
// filter-coefficient/gain state, which most browsers propagate as silence
// from that node onward -- not a loud glitch, just quietly no sound, which
// is exactly the kind of bug that's hard to spot from the value alone.
// Every 0-127 byte -> seconds/normalized/Hz conversion in this file goes
// through this first so a bad upstream value degrades to a safe default
// instead of silently taking the voice out.
function safeByte(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

// First-pass approximation of the E-mu 0-127 envelope rate byte -> seconds.
// Not calibrated against real hardware timing; revisit if A/B listening
// shows specific presets (pads, sweeps) sound audibly wrong. See
// docs/ARCHITECTURE.md §3.
function rateByteToSeconds(rate: number): number {
  const minTime = 0.001
  const maxTime = 20
  const frac = Math.min(1, Math.max(0, safeByte(rate) / 127))
  return minTime + (maxTime - minTime) * frac ** 3
}

function levelByteToNormalized(level: number): number {
  return Math.min(1, Math.max(0, safeByte(level) / 127))
}

// Q=0 is a degenerate value for the standard (RBJ cookbook) biquad filter
// formula that both browsers' native BiquadFilterNode and Tone.Filter use
// internally -- Q appears in a 1/(2*Q) term, so Q=0 produces NaN/unstable
// coefficients and silences the signal. resonance=0 is the overwhelmingly
// common byte value across this bank, so mapping it straight to Q=0 (as
// an earlier version did) broke nearly every non-percussive preset --
// confirmed live: filterHz/gain/envelope all looked correct, only Q was
// the outlier. Floor raised to 0.707 (the standard "flat"/Butterworth
// response for resonance=0), scaling up from there. Ceiling deliberately
// kept well short of "true" self-oscillation range (Q well above ~10-12 on
// a resonant lowpass/highpass rings hard at the cutoff frequency for
// almost any transient input, drowning out the actual sample in a pure
// tone) -- this only mattered for mod-matrix modulation math while the
// filter was bypassed from playback entirely; now that it's actually in
// the audio chain for Sound Design presets, a max Q of ~20 turned any
// mid-to-high resonance setting into exactly that "beep" artifact.
function resonanceToQ(resonance: number): number {
  const frac = Math.min(1, Math.max(0, safeByte(resonance) / 127))
  return 0.707 + frac * 8.3 // -> ~0.707..9
}

// lowshelf/highshelf/peaking are the only BiquadFilterNode types that use
// `gain` at all (WebAudio spec) -- Tone.Filter defaults it to 0dB, which is
// a literal no-op for those three types regardless of cutoff/Q (confirmed:
// this is exactly why they "looked unfiltered"). Reuses the same Resonance
// dial as a boost amount for these types -- 0 = no boost (matches
// Resonance's "neutral" meaning for every other type), up to +18dB at max.
const SHELF_PEAK_TYPES = new Set(['lowshelf', 'highshelf', 'peaking'])
function resonanceToShelfGainDb(resonance: number): number {
  const frac = Math.min(1, Math.max(0, safeByte(resonance) / 127))
  return frac * 18
}

// Cutoff is a raw Hz value (not a 0-127 byte), so it gets its own guard --
// same reasoning as safeByte() above, falling back to fully-open (silently
// inaudible, the safe direction to fail in) rather than passing NaN/an
// out-of-range value straight to a BiquadFilterNode.
function safeCutoffHz(hz: number): number {
  return Number.isFinite(hz) ? Math.min(20000, Math.max(20, hz)) : 20000
}

// Folds the 6-stage E-mu envelope into Tone's 4-stage ADSR. Stage-2 values
// are ignored when at their documented no-op defaults (attack2Level=0x7F,
// meaning "stage 2 is a continuation at full level"); a real 6-stage
// envelope is a documented v1 gap, not silently dropped -- see
// docs/ARCHITECTURE.md §3.
function toAdsr(env: Envelope) {
  return {
    attack: rateByteToSeconds(env.attack1Rate),
    decay: rateByteToSeconds(env.decay1Rate),
    sustain: levelByteToNormalized(env.sustainLevel),
    release: rateByteToSeconds(env.release1Rate),
  }
}

export interface VoiceOptions {
  bankId: string
  layer: Layer
  // Patch-level filter (preset.filter/preset.filterEnv) lives here, not on
  // Layer -- see docs/plans/sound-design-ui.md and core/audio/types.ts.
  preset: Preset
  zone: Zone
  note: number
  velocity01: number
  pitchBendSemitones: number
  sampleCache: SampleCache
  modWheelSignal: Tone.Signal<'normalRange'>
  // Live, shared (per-VoiceManager, not per-voice) sources -- see
  // docs/ARCHITECTURE.md / Manual.pdf p.156-160.
  pitchWheelSignal: Tone.Signal<'audioRange'>
  pressureSignal: Tone.Signal<'normalRange'>
  getCCSignal: (cc: number) => Tone.Signal<'normalRange'>
  // Shared, per-active-preset LFO pair (VoiceManager, from Preset.lfo1/
  // lfo2) -- distinct from this Voice's own per-layer lfo1/lfo2 below. Only
  // used as Mod Matrix sources for `preset.modMatrix` routings ('patchLfo1'/
  // 'patchLfo2') -- see docs/plans/FX-Modulations.md.
  patchLfo1: Tone.LFO
  patchLfo2: Tone.LFO
  // The active preset's Preset FX chain (core/audio/effects.ts) -- always
  // present. `destination` is already fxChain.input (VoiceManager wires
  // it), threaded separately here only so the Mod Matrix's `wetDryMix`
  // destination has something to target.
  fxChain: EffectChain
  destination: Tone.ToneAudioNode
  audioContext: AudioContext
}

export class Voice {
  readonly note: number
  readonly triggeredAt: number

  private player!: Tone.Player
  private ampEnv!: Tone.AmplitudeEnvelope
  // Only constructed when this preset has a patch-level filter AND it's
  // enabled for this bank -- see build().
  private filterEnv: Tone.Envelope | undefined
  private filter: Tone.Filter | undefined
  private panner!: Tone.Panner
  private outGain!: Tone.Gain
  private lfo1!: Tone.LFO
  private lfo2!: Tone.LFO
  // Per-voice (unlike modWheel/pitchWheel/pressure, which are shared) --
  // full value while the note is held, 0 once released. See Manual.pdf
  // p.157's "Gate" source.
  private gateSignal!: Tone.Signal<'normalRange'>
  private disposables: Array<{ dispose: () => void }> = []
  private disposed = false
  private releasing = false

  private opts: VoiceOptions

  private constructor(opts: VoiceOptions) {
    this.opts = opts
    this.note = opts.note
    this.triggeredAt = Tone.now()
  }

  static async create(opts: VoiceOptions): Promise<Voice> {
    const voice = new Voice(opts)
    await voice.build()
    return voice
  }

  get isReleasing(): boolean {
    return this.releasing
  }

  private async build() {
    const {
      layer, preset, zone, note, velocity01, pitchBendSemitones, sampleCache, bankId,
      modWheelSignal, pitchWheelSignal, pressureSignal, getCCSignal, patchLfo1, patchLfo2,
      fxChain, destination,
    } = this.opts

    const buffer = await sampleCache.getDecoded(bankId, zone)
    if (this.disposed) return // released/stolen while the sample was loading

    this.player = new Tone.Player(new Tone.ToneAudioBuffer(buffer))
    this.player.fadeIn = 0.002
    this.player.fadeOut = 0.02

    // Loop whenever the sample itself has loop data enabled. This was
    // reverted once (see git history) on a mistaken reading of the real
    // Emulator X3 editor's per-voice "Direction" field (Forward/Backward/
    // Forward Loop/Backward Loop/One-Shot) as an override that could force
    // non-looping even when the sample has valid loop points. Confirmed
    // directly against the real app: that's wrong -- if a sample has loop
    // data enabled, it loops while the note is held, regardless of
    // Direction. The "still sounds wrong when looping" symptom that
    // triggered the original revert was actually the amp-envelope
    // double-connect bug and the filter's wrong-in-kind cutoff estimate
    // (both fixed since, see below and docs/ARCHITECTURE.md) confounding
    // the result, not looping itself being wrong.
    if (zone.isLooping && zone.sampleRate) {
      this.player.loop = true
      this.player.loopStart = zone.loopStart / zone.sampleRate
      this.player.loopEnd = zone.loopEnd / zone.sampleRate
    }

    this.applyPitch(note, layer.params.transposeSemitones, layer.params.fineTuneCents,
      zone.rootKey, zone.fineTune, layer.params.nonTranspose, pitchBendSemitones)

    // Amp envelope may be this layer's own, or shared via a layer group /
    // the whole patch -- see core/soundDesign/envelopeScope.ts.
    const ampEnvelope = resolveAmpEnvelope(layer, preset)
    this.ampEnv = new Tone.AmplitudeEnvelope(toAdsr(ampEnvelope))

    // Patch-level filter: one per preset, not per layer (see
    // core/audio/types.ts). Only constructed when it's actually going to be
    // used -- `preset.filterBypassed` is the user-facing on/off toggle
    // (Filter tab, Sound Design or Performance mode), and `preset.filter`/
    // `preset.filterEnv` are absent entirely for presets that have never had
    // a Filter tab opened for them. `preset.filter`/`filterEnv` are NEVER
    // derived from a bank's raw per-layer filterTypeRaw/cutoffRaw bytes --
    // those stay unread regardless (see the big comment below) -- they're
    // either absent or were explicitly set by a human through a Filter tab,
    // so unlike that raw per-layer data, they're always safe to play back
    // no matter which bank/mode created them. (Previously also gated on an
    // AudioEngine.isFilterEnabled bank-source check that conflated the two;
    // removed -- it was blocking Performance mode's Filter tab from ever
    // being audible for any preset from a non-user-created bank, including
    // ones a user had just explicitly configured through that very tab.)
    if (!preset.filterBypassed && preset.filter && preset.filterEnv) {
      this.filter = new Tone.Filter({
        type: preset.filter.typeEstimated as BiquadFilterType,
        frequency: safeCutoffHz(preset.filter.cutoffHzEstimated),
        Q: resonanceToQ(preset.filter.resonance),
        gain: SHELF_PEAK_TYPES.has(preset.filter.typeEstimated) ? resonanceToShelfGainDb(preset.filter.resonance) : 0,
      })
      this.filterEnv = new Tone.Envelope(toAdsr(preset.filterEnv))
    }

    this.panner = new Tone.Panner(this.resolvePan(zone.pan, layer.params.pan))
    const volumeDb = zone.volumeDb ?? layer.params.volumeDb
    this.outGain = new Tone.Gain(Tone.dbToGain(volumeDb))

    this.lfo1 = new Tone.LFO({ frequency: lfoRateToHz(layer.lfo1.rate), type: lfoShapeToType(layer.lfo1.shape) })
    this.lfo2 = new Tone.LFO({ frequency: lfoRateToHz(layer.lfo2.rate), type: lfoShapeToType(layer.lfo2.shape) })
    this.gateSignal = new Tone.Signal({ value: 1, units: 'normalRange' })
    // Key-synced LFOs reset phase per note (start here, at voice creation);
    // free-running LFOs ideally share one instance per active preset so
    // they don't reset phase per note -- deferred to M6 polish per the
    // plan; both flavors are per-voice for now (documented simplification).
    this.lfo1.start()
    this.lfo2.start()

    // Tone.AmplitudeEnvelope is an audio-signal in/out node (input gated
    // by the envelope), not a control source to .connect() elsewhere --
    // routing it in the chain below is the entire mechanism. An earlier
    // version also did `this.ampEnv.connect(this.outGain.gain)`, which
    // fed the actual gated *audio waveform* into outGain's gain AudioParam
    // as a modulation signal on top of its base value -- self-modulating
    // output gain with the voice's own audio content. Sustained/tonal
    // sounds came out silent or mangled; short percussive transients
    // survived it well enough to sound fine, which is exactly the "drums
    // work, other presets don't" symptom that gave this away.
    // Filter is only in the chain when actually constructed above -- absent
    // for Orbit-3 and any other bank with auto-estimated/missing filter
    // data: cutoffRaw/typeRaw -> Hz/type was already flagged unvalidated,
    // and turned out to be flat-out wrong in *kind*, not just miscalibrated
    // -- checked against the real Emulator X3 editor, hit:Intruder's "HARD
    // syn C2" filter type is "Bat Phaser" (Res=0, Freq=28.6Hz), one of
    // E-mu's many exotic Z-plane filter types with no Web Audio
    // BiquadFilterNode equivalent. The cutoff-byte-to-Hz formula treats
    // every filter as a simple lowpass, so for non-lowpass types it's not
    // just imprecise, it's answering a question that doesn't apply (a
    // phaser's "Freq" isn't a cutoff), and a wrong filter estimate can
    // silence a voice outright. A preset with `preset.filter` set doesn't
    // have this problem regardless of which bank it's from: that field's
    // type/cutoff/resonance are only ever set directly via a Filter tab's
    // (Sound Design's or Performance mode's) 8 real BiquadFilterNode types,
    // never estimated from unvalidated raw bytes -- see docs/ARCHITECTURE.md
    // for the full story.
    if (this.filter) {
      this.player.chain(this.ampEnv, this.filter, this.panner, this.outGain, destination)
    } else {
      this.player.chain(this.ampEnv, this.panner, this.outGain, destination)
    }

    // Temporary diagnostic -- remove once silent-preset triage is done.
    // filterBuilt/filterQ/filterFreqActual show what actually landed on the
    // Tone.Filter node (post safeCutoffHz/resonanceToQ clamping), separate
    // from filterType/filterHz which are the raw preset config -- if a
    // preset goes silent with the filter enabled, compare the two: a config
    // that looks sane but produced a NaN/wildly-off actual value points at
    // a data problem upstream of Voice.ts, not the filter math itself.
    console.info('[Voice] build', {
      sample: zone.sampleName, wavFile: zone.wavFile, bufferDuration: buffer.duration,
      note, rootKey: zone.rootKey, playbackRate: this.player.playbackRate,
      filterBypassed: preset.filterBypassed, filterType: preset.filter?.typeEstimated ?? '(none)',
      filterHz: preset.filter?.cutoffHzEstimated, filterResonance: preset.filter?.resonance,
      filterBuilt: !!this.filter,
      filterFreqActual: this.filter?.frequency.value, filterQActual: this.filter?.Q.value,
      outGainLinear: Tone.dbToGain(volumeDb), volumeDb,
      ampEnvAdsr: toAdsr(ampEnvelope), ampEnvScope: layer.ampEnvScope?.kind ?? 'own',
      pan: this.resolvePan(zone.pan, layer.params.pan),
      isLooping: zone.isLooping, loopStartSec: this.player.loopStart, loopEndSec: this.player.loopEnd,
    })

    const modMatrixTargets = {
      player: this.player,
      filter: this.filter,
      filterEnv: this.filterEnv,
      lfo1: this.lfo1,
      lfo2: this.lfo2,
      patchLfo1,
      patchLfo2,
      modWheelSignal,
      pitchWheelSignal,
      pressureSignal,
      gateSignal: this.gateSignal,
      getCCSignal,
      velocity01,
      key01: note / 127,
      fxChain,
      disposables: this.disposables,
    }
    // Layer's own routings, then the patch-level ones (Preset.modMatrix --
    // see docs/plans/FX-Modulations.md) -- both apply to every voice, on
    // top of each other, same `disposables` array for cleanup.
    applyModMatrix(layer.modMatrix, modMatrixTargets)
    applyModMatrix(preset.modMatrix ?? [], modMatrixTargets)

    this.player.start()
    this.ampEnv.triggerAttack(Tone.now(), velocity01)
    this.filterEnv?.triggerAttack(Tone.now())
  }

  /** Re-applies the active preset's filter type/cutoff/resonance onto this
   * voice's already-constructed filter node, live, no dispose/recreate
   * needed (frequency/Q/type/gain are all live-settable on a running
   * Tone.Filter) -- called from VoiceManager.refreshFilter() whenever the
   * preset's filter fields change, so twisting the Cutoff dial mid-note
   * sweeps a held/sustaining note instead of only affecting the next
   * note-on. No-op for a voice that was built without a filter (bypassed or
   * unconfigured at the time it was triggered) -- a filter node can't be
   * spliced into an already-connected chain live, so bypass/enable only
   * takes effect on the next note-on, same as any other structural chain
   * change. */
  updateFilterLive(preset: Preset): void {
    if (!this.filter || !preset.filter) return
    const type = preset.filter.typeEstimated as BiquadFilterType
    this.filter.type = type
    this.filter.frequency.value = safeCutoffHz(preset.filter.cutoffHzEstimated)
    this.filter.Q.value = resonanceToQ(preset.filter.resonance)
    this.filter.gain.value = SHELF_PEAK_TYPES.has(type) ? resonanceToShelfGainDb(preset.filter.resonance) : 0
  }

  // Tone.Player.playbackRate is a plain number setter (not a connectable
  // Tone.Param), so all pitch here is static -- computed once at note-on.
  // Live pitch modulation from the mod matrix is a documented v1 gap, see
  // modMatrix.ts.
  private applyPitch(
    note: number, transposeSemitones: number, layerFineTuneCents: number,
    rootKey: number, zoneFineTune: number, nonTranspose: boolean, pitchBendSemitones: number,
  ) {
    const semitones = nonTranspose ? 0 : (note - rootKey) + transposeSemitones + pitchBendSemitones
    const zoneFineTuneCents = (zoneFineTune / 64) * 100 // zone.fineTune is 1/64-semitone units
    const totalCents = semitones * 100 + zoneFineTuneCents + layerFineTuneCents
    this.player.playbackRate = 2 ** (totalCents / 1200)
  }

  private resolvePan(zonePan: number | null, layerPan: number): number {
    const raw = zonePan ?? layerPan // -64..63
    return Math.min(1, Math.max(-1, raw / 64))
  }

  release(): void {
    if (this.releasing || this.disposed) return
    this.releasing = true
    if (!this.player) {
      // Sample was still loading when noteOff arrived; mark disposed so
      // build() bails out once the fetch/decode resolves.
      this.disposed = true
      return
    }
    const now = Tone.now()
    this.ampEnv.triggerRelease(now)
    this.filterEnv?.triggerRelease(now)
    this.gateSignal.value = 0
    const longestRelease = Math.max(this.ampEnv.release as number, (this.filterEnv?.release as number) ?? 0)
    const cleanupMs = (longestRelease + 0.3) * 1000
    setTimeout(() => this.dispose(), cleanupMs)
  }

  /** Immediate cutoff, no release tail -- used by panic/voice-stealing. */
  forceStop(): void {
    this.dispose()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const d of this.disposables) d.dispose()
    this.player?.dispose()
    this.ampEnv?.dispose()
    this.filterEnv?.dispose()
    this.filter?.dispose()
    this.panner?.dispose()
    this.outGain?.dispose()
    this.lfo1?.dispose()
    this.lfo2?.dispose()
    this.gateSignal?.dispose()
  }
}
