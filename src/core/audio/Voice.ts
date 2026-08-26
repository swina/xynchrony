// One polyphonic sound-producing instance, spawned per matched Zone per
// note-on (see VoiceManager -- multiple Voices routinely sound together
// for one note-on, by design: docs/ARCHITECTURE.md §1.2 "true layering").
//
// Chain: Player -> Gain(ampEnv) -> [Filter, Sound Design banks only] -> Panner -> Gain(output) -> bus
import * as Tone from 'tone'
import type { Layer, Zone, Envelope } from './types'
import { applyModMatrix } from './modMatrix'
import type { SampleCache } from './SampleCache'

// First-pass approximation of the E-mu 0-127 envelope rate byte -> seconds.
// Not calibrated against real hardware timing; revisit if A/B listening
// shows specific presets (pads, sweeps) sound audibly wrong. See
// docs/ARCHITECTURE.md §3.
function rateByteToSeconds(rate: number): number {
  const minTime = 0.001
  const maxTime = 20
  const frac = Math.min(1, Math.max(0, rate / 127))
  return minTime + (maxTime - minTime) * frac ** 3
}

function levelByteToNormalized(level: number): number {
  return Math.min(1, Math.max(0, level / 127))
}

// Q=0 is a degenerate value for the standard (RBJ cookbook) biquad filter
// formula that both browsers' native BiquadFilterNode and Tone.Filter use
// internally -- Q appears in a 1/(2*Q) term, so Q=0 produces NaN/unstable
// coefficients and silences the signal. resonance=0 is the overwhelmingly
// common byte value across this bank, so mapping it straight to Q=0 (as
// an earlier version did) broke nearly every non-percussive preset --
// confirmed live: filterHz/gain/envelope all looked correct, only Q was
// the outlier. Floor raised to 0.707 (the standard "flat"/Butterworth
// response for resonance=0), scaling up from there.
function resonanceToQ(resonance: number): number {
  const frac = Math.min(1, Math.max(0, resonance / 127))
  return 0.707 + frac * 19.3 // -> ~0.707..20
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
  zone: Zone
  note: number
  velocity01: number
  pitchBendSemitones: number
  sampleCache: SampleCache
  modWheelSignal: Tone.Signal<'normalRange'>
  getCCSignal: (cc: number) => Tone.Signal<'normalRange'>
  // See AudioEngine.loadBank() / docs/ARCHITECTURE.md -- only true for
  // Sound Design-authored bank data.
  filterEnabled: boolean
  destination: Tone.ToneAudioNode
  audioContext: AudioContext
}

export class Voice {
  readonly note: number
  readonly triggeredAt: number

  private player!: Tone.Player
  private ampEnv!: Tone.AmplitudeEnvelope
  private filterEnv!: Tone.Envelope
  private filter!: Tone.Filter
  private panner!: Tone.Panner
  private outGain!: Tone.Gain
  private lfo1!: Tone.LFO
  private lfo2!: Tone.LFO
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
    const { layer, zone, note, velocity01, pitchBendSemitones, sampleCache, bankId, modWheelSignal, getCCSignal, filterEnabled, destination } = this.opts

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

    this.ampEnv = new Tone.AmplitudeEnvelope(toAdsr(layer.ampEnv))
    this.filterEnv = new Tone.Envelope(toAdsr(layer.filterEnv))

    // Filter node is always constructed so applyModMatrix has something to
    // connect to, but it's only spliced into the audio chain below when
    // `filterEnabled` -- see the chain-building comment further down.
    const cutoff = layer.params.filter.cutoffHzEstimated
    this.filter = new Tone.Filter({
      type: layer.params.filter.typeEstimated as BiquadFilterType,
      frequency: cutoff,
      Q: resonanceToQ(layer.params.filter.resonance),
    })

    this.panner = new Tone.Panner(this.resolvePan(zone.pan, layer.params.pan))
    const volumeDb = zone.volumeDb ?? layer.params.volumeDb
    this.outGain = new Tone.Gain(Tone.dbToGain(volumeDb))

    this.lfo1 = new Tone.LFO({ frequency: this.lfoRateToHz(layer.lfo1.rate), type: this.lfoShapeToType(layer.lfo1.shape) })
    this.lfo2 = new Tone.LFO({ frequency: this.lfoRateToHz(layer.lfo2.rate), type: this.lfoShapeToType(layer.lfo2.shape) })
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
    // Filter is only in the chain for Sound Design-authored bank data
    // (`filterEnabled`, set by AudioEngine.loadBank() from the loaded
    // Bank's `_meta.source`). It stays OUT of the chain for Orbit-3 and any
    // other bank with auto-estimated filter data: cutoffRaw/typeRaw ->
    // Hz/type was already flagged unvalidated, and turned out to be
    // flat-out wrong in *kind*, not just miscalibrated -- checked against
    // the real Emulator X3 editor, hit:Intruder's "HARD syn C2" filter type
    // is "Bat Phaser" (Res=0, Freq=28.6Hz), one of E-mu's many exotic
    // Z-plane filter types with no Web Audio BiquadFilterNode equivalent.
    // The cutoff-byte-to-Hz formula treats every filter as a simple
    // lowpass, so for non-lowpass types it's not just imprecise, it's
    // answering a question that doesn't apply (a phaser's "Freq" isn't a
    // cutoff), and a wrong filter estimate can silence a voice outright.
    // Sound Design presets don't have this problem: type/cutoff/resonance
    // are set directly via the Filter tab's 8 real BiquadFilterNode types,
    // not estimated from unvalidated raw bytes -- see
    // docs/ARCHITECTURE.md for the full story.
    if (filterEnabled) {
      this.player.chain(this.ampEnv, this.filter, this.panner, this.outGain, destination)
    } else {
      this.player.chain(this.ampEnv, this.panner, this.outGain, destination)
    }

    // Temporary diagnostic -- remove once silent-preset triage is done.
    console.info('[Voice] build', {
      sample: zone.sampleName, wavFile: zone.wavFile, bufferDuration: buffer.duration,
      note, rootKey: zone.rootKey, playbackRate: this.player.playbackRate,
      filterType: layer.params.filter.typeEstimated, filterHz: cutoff,
      Q: resonanceToQ(layer.params.filter.resonance),
      outGainLinear: Tone.dbToGain(volumeDb), volumeDb,
      ampEnvAdsr: toAdsr(layer.ampEnv),
      pan: this.resolvePan(zone.pan, layer.params.pan),
      isLooping: zone.isLooping, loopStartSec: this.player.loopStart, loopEndSec: this.player.loopEnd,
    })

    applyModMatrix(layer.modMatrix, {
      player: this.player,
      filter: this.filter,
      filterEnv: this.filterEnv,
      lfo1: this.lfo1,
      lfo2: this.lfo2,
      modWheelSignal,
      getCCSignal,
      velocity01,
      disposables: this.disposables,
    })

    this.player.start()
    this.ampEnv.triggerAttack(Tone.now(), velocity01)
    this.filterEnv.triggerAttack(Tone.now())
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

  private lfoRateToHz(rate: number): number {
    // 0-127 -> roughly 0.05Hz .. 20Hz, exponential (unvalidated, same
    // caveat class as the envelope rate mapping above).
    const frac = Math.min(1, Math.max(0, rate / 127))
    return 0.05 * (400 ** frac)
  }

  private lfoShapeToType(shape: string): Tone.ToneOscillatorType {
    switch (shape) {
      case 'sine': return 'sine'
      case 'sawtooth': return 'sawtooth'
      case 'square': return 'square'
      case 'triangle':
      default:
        return 'triangle'
    }
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
    this.filterEnv.triggerRelease(now)
    const longestRelease = Math.max(this.ampEnv.release as number, this.filterEnv.release as number)
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
  }
}
