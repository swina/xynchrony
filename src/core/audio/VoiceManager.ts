// Note-on/off -> zone lookup -> spawn/release Voice. See
// docs/ARCHITECTURE.md §1.2 and §3: overlapping zones ALL sound together
// for one note-on (true layering), not just the narrowest match.
import * as Tone from 'tone'
import type { Preset } from './types'
import { Voice } from './Voice'
import { EffectChain, blankFxChain } from './effects'
import { lfoRateToHz, lfoShapeToType, syncDivisionToHz } from './lfoMapping'
import { blankLfo } from '../soundDesign/defaults'
import type { SampleCache } from './SampleCache'

const DEFAULT_POLYPHONY = 64

export class VoiceManager {
  private activeVoices = new Map<string, Voice[]>() // key: `${note}` -> voices
  private allVoices = new Set<Voice>()
  private activePreset: Preset | null = null
  readonly modWheelSignal: Tone.Signal<'normalRange'>
  // Live sources added for the Manual.pdf p.156-160 catalog -- see
  // docs/ARCHITECTURE.md. Shared across all voices (unlike Voice.ts's own
  // per-voice gateSignal).
  readonly pitchWheelSignal: Tone.Signal<'audioRange'>
  readonly pressureSignal: Tone.Signal<'normalRange'>
  // Lazily-created per-CC live signals for Mod Matrix slots with a custom
  // `midiCC` set (see modMatrix.ts) -- same idea as modWheelSignal, but one
  // per referenced CC number instead of a single hardcoded CC1.
  private ccSignals = new Map<number, Tone.Signal<'normalRange'>>()
  // Preset FX: one shared EffectChain per active preset, not one per voice
  // -- every voice of the current preset feeds into it, so simultaneous
  // notes share one reverb "room" instead of independent tails. See
  // core/audio/effects.ts.
  private fxChain: EffectChain
  // Patch-level LFO pair (Preset.lfo1/lfo2): one shared instance per active
  // preset, same reasoning as fxChain above -- distinct from each Layer's
  // own per-voice lfo1/lfo2 (Voice.ts). Always running once created; only
  // frequency/type are updated live (setPreset()/refreshPatchLfo()), never
  // disposed/recreated on every tweak. See docs/plans/FX-Modulations.md.
  private patchLfo1: Tone.LFO
  private patchLfo2: Tone.LFO

  private bankId: string
  private sampleCache: SampleCache
  private destination: Tone.ToneAudioNode
  private audioContext: AudioContext
  private polyphonyLimit: number
  private pitchBendSemitonesValue = 0
  // See useGlobalTempo.ts / AudioEngine.setGlobalTempo() -- only consulted
  // when a patch-level LFO's rateMode is 'sync'.
  private bpm = 120

  constructor(
    bankId: string,
    sampleCache: SampleCache,
    destination: Tone.ToneAudioNode,
    audioContext: AudioContext,
    polyphonyLimit = DEFAULT_POLYPHONY,
  ) {
    this.bankId = bankId
    this.sampleCache = sampleCache
    this.destination = destination
    this.audioContext = audioContext
    this.polyphonyLimit = polyphonyLimit
    this.modWheelSignal = new Tone.Signal({ value: 0, units: 'normalRange' })
    this.pitchWheelSignal = new Tone.Signal({ value: 0, units: 'audioRange' })
    this.pressureSignal = new Tone.Signal({ value: 0, units: 'normalRange' })
    this.fxChain = new EffectChain()
    this.fxChain.rebuild(blankFxChain())
    this.fxChain.output.connect(this.destination)
    const defaultLfo = blankLfo()
    // min/max: -1..1 -- Tone.LFO otherwise defaults to a 0..1 UNIPOLAR
    // output, which would only ever nudge a modulated destination one
    // direction from its base value instead of sweeping symmetrically
    // around it (modMatrix.ts's baseFor()/baseValues). See Voice.ts's
    // per-layer lfo1/lfo2 for the same fix, same reasoning.
    this.patchLfo1 = new Tone.LFO({ frequency: lfoRateToHz(defaultLfo.rate), type: lfoShapeToType(defaultLfo.shape), min: -1, max: 1 }).start()
    this.patchLfo2 = new Tone.LFO({ frequency: lfoRateToHz(defaultLfo.rate), type: lfoShapeToType(defaultLfo.shape), min: -1, max: 1 }).start()
  }

  setPreset(preset: Preset | null): void {
    this.panic()
    this.activePreset = preset
    this.fxChain.rebuild(preset?.fx ?? blankFxChain())
    this.applyPatchLfoSettings()
  }

  /** Re-reads the active preset's `fx` config and rebuilds the chain from
   * it, without the panic()/voice-stealing that setPreset() does -- for
   * live edits to the *same* preset's FX (Performance mode's Preset FX
   * pane, Sound Design's FX tab) that shouldn't cut off sustained notes. */
  refreshFx(): void {
    this.fxChain.rebuild(this.activePreset?.fx ?? blankFxChain())
  }

  /** Re-applies the active preset's lfo1/lfo2 rate+shape onto the shared
   * patch-level LFO instances, live, no dispose/recreate needed (frequency/
   * type are both live-settable on a running Tone.LFO) -- see
   * docs/plans/FX-Modulations.md. Same documented rate/shape-only scope as
   * every layer's own LFOs (Voice.ts). */
  refreshPatchLfo(): void {
    this.applyPatchLfoSettings()
  }

  /** See useGlobalTempo.ts -- called whenever the app-wide BPM changes.
   * Re-applies immediately so an already-sync'd patch LFO's rate updates
   * live, same as any other patch-level LFO edit. */
  setBpm(bpm: number): void {
    this.bpm = bpm
    this.applyPatchLfoSettings()
  }

  /** Re-applies the active preset's filter type/cutoff/resonance onto
   * every currently-sounding voice's already-built filter node, live --
   * see Voice.updateFilterLive() for why this doesn't need a
   * dispose/recreate. No-op for voices built without a filter (bypassed or
   * unconfigured at note-on time); those only pick up a filter on their
   * next note-on. */
  refreshFilter(): void {
    if (!this.activePreset) return
    for (const voice of this.allVoices) voice.updateFilterLive(this.activePreset)
  }

  private applyPatchLfoSettings(): void {
    const lfo1 = this.activePreset?.lfo1 ?? blankLfo()
    const lfo2 = this.activePreset?.lfo2 ?? blankLfo()
    this.patchLfo1.frequency.value = this.resolveLfoHz(lfo1)
    this.patchLfo1.type = lfoShapeToType(lfo1.shape)
    this.patchLfo2.frequency.value = this.resolveLfoHz(lfo2)
    this.patchLfo2.type = lfoShapeToType(lfo2.shape)
  }

  private resolveLfoHz(lfo: { rate: number; rateMode?: 'hz' | 'sync'; syncDivision?: string }): number {
    if (lfo.rateMode === 'sync' && lfo.syncDivision) return syncDivisionToHz(lfo.syncDivision, this.bpm)
    return lfoRateToHz(lfo.rate)
  }

  private heldNotes = new Set<number>()
  // Previous note-on, tracked whole-preset-wide (not per layer/zone) so a
  // new voice's Glide (Preset.glide) knows what pitch to slide from --
  // Voice.ts computes its own start-pitch for this note using its own
  // layer/zone mapping (transpose/fine-tune/root-key), so a single tracked
  // MIDI note number is enough regardless of how many layers a preset has.
  private lastNote: number | null = null
  private lastVelocity = 100
  // Monophonic mode's note-priority stack (oldest..newest) -- see noteOn()/
  // noteOff(). Only meaningful when activePreset.voiceMode === 'mono'.
  private monoStack: number[] = []
  // Latch's FIFO hold buffer (oldest..newest) -- see noteOn()/noteOff()/
  // releaseAllLatched(). Only meaningful when activePreset.latch?.enabled.
  private latchQueue: number[] = []

  get activeVoiceCount(): number {
    return this.allVoices.size
  }

  get heldNoteList(): number[] {
    return [...this.heldNotes]
  }

  /** Builds one Voice per matching (layer, zone) for `note`, adding each to
   * `allVoices` -- the shared spawn logic behind normal poly/mono note-on
   * and mono's note-off fallback retrigger. `glideFromNote` is the MIDI
   * note each spawned voice should glide its pitch from (null = no glide,
   * jump straight to target -- see Voice.ts's build()). */
  private async spawnVoicesForNote(
    note: number, velocity: number,
    matches: Array<{ layer: import('./types').Layer; zone: import('./types').Zone }>,
    glideFromNote: number | null,
  ): Promise<Voice[]> {
    if (!this.activePreset) return []
    const preset = this.activePreset
    const velocity01 = Math.min(1, Math.max(0, velocity / 127))
    const spawned: Voice[] = []
    for (const { layer, zone } of matches) {
      try {
        const voice = await Voice.create({
          bankId: this.bankId,
          layer,
          preset,
          zone,
          note,
          velocity01,
          pitchBendSemitones: this.pitchBendSemitonesValue,
          glideFromNote,
          sampleCache: this.sampleCache,
          modWheelSignal: this.modWheelSignal,
          pitchWheelSignal: this.pitchWheelSignal,
          pressureSignal: this.pressureSignal,
          getCCSignal: (cc: number) => this.getCCSignal(cc),
          patchLfo1: this.patchLfo1,
          patchLfo2: this.patchLfo2,
          customMidiSources: preset.customMidiSources ?? [],
          fxChain: this.fxChain,
          // Every voice of the active preset feeds the shared Preset FX
          // chain, not this.destination directly -- see the constructor.
          destination: this.fxChain.input,
          audioContext: this.audioContext,
        })
        spawned.push(voice)
        this.allVoices.add(voice)
      } catch (e) {
        console.warn(`[VoiceManager] failed to spawn voice for sample "${zone.sampleName}":`, e)
      }
    }
    return spawned
  }

  /** Releases whatever's currently sounding for `note` (the shared release
   * logic behind normal note-off and latch's FIFO eviction). */
  private releaseNoteVoices(note: number): void {
    const key = String(note)
    const voices = this.activeVoices.get(key)
    if (!voices) return
    this.activeVoices.delete(key) // new note-ons for this key shouldn't touch the releasing tail
    for (const voice of voices) {
      voice.release()
      // Keep tracking in allVoices until it actually disposes, so
      // activeVoiceCount reflects releasing-but-still-sounding voices.
      const removeWhenDone = () => this.allVoices.delete(voice)
      setTimeout(removeWhenDone, 30_000) // safety net; dispose() is the real trigger path
    }
  }

  /** Immediate cutoff of everything currently sounding, without touching
   * heldNotes/monoStack/latchQueue -- monophonic mode's legato retrigger:
   * a new note (or falling back to the previous one on release) always
   * replaces whatever's currently sounding rather than layering onto it. */
  private stopAllVoicesImmediate(): void {
    for (const voices of this.activeVoices.values()) {
      for (const voice of voices) {
        voice.forceStop()
        this.allVoices.delete(voice)
      }
    }
    this.activeVoices.clear()
  }

  async noteOn(note: number, velocity: number): Promise<void> {
    if (velocity <= 0) return this.noteOff(note)
    if (!this.activePreset) return
    const preset = this.activePreset // narrowed once, used across the async loop below

    this.heldNotes.add(note)
    this.lastVelocity = velocity
    const glideFromNote = preset.glide?.enabled ? this.lastNote : null
    this.lastNote = note

    const matches = this.collectMatchingZones(note, velocity)
    // Temporary diagnostic -- remove once silent-preset triage is done.
    console.info(`[VoiceManager] noteOn(${note}, vel=${velocity}) preset="${preset.name}" `
      + `-> ${matches.length} matching zone(s):`, matches.map((m) => m.zone.sampleName))
    if (matches.length === 0) return

    if (preset.voiceMode === 'mono') {
      // Monophonic: last-note-priority -- a new note always replaces
      // whatever's currently sounding (legato retrigger), never layers.
      this.monoStack = this.monoStack.filter((n) => n !== note)
      this.monoStack.push(note)
      this.stopAllVoicesImmediate()
      const spawned = await this.spawnVoicesForNote(note, velocity, matches, glideFromNote)
      this.activeVoices.set(String(note), spawned)
    } else {
      this.enforcePolyphony(matches.length)
      const spawned = await this.spawnVoicesForNote(note, velocity, matches, glideFromNote)
      const key = String(note)
      const existing = this.activeVoices.get(key) ?? []
      this.activeVoices.set(key, [...existing, ...spawned])
    }

    if (preset.latch?.enabled) {
      this.latchQueue = this.latchQueue.filter((n) => n !== note)
      this.latchQueue.push(note)
      const maxNotes = Math.min(6, Math.max(1, preset.latch.maxNotes))
      while (this.latchQueue.length > maxNotes) {
        const evicted = this.latchQueue.shift()!
        this.releaseNoteVoices(evicted)
      }
    }
  }

  noteOff(note: number): void {
    this.heldNotes.delete(note)
    const preset = this.activePreset

    // Latched: key-up doesn't release -- the note keeps sounding until FIFO
    // eviction (noteOn above) or the Latch toggle is turned off
    // (releaseAllLatched()).
    if (preset?.latch?.enabled && this.latchQueue.includes(note)) return

    if (preset?.voiceMode === 'mono') {
      // Only releasing the currently-sounding (topmost) note can change
      // what's audible -- releasing a background held note further down
      // the stack just updates note-priority bookkeeping, no retrigger.
      const wasSounding = this.monoStack.length > 0 && this.monoStack[this.monoStack.length - 1] === note
      this.monoStack = this.monoStack.filter((n) => n !== note)
      if (!wasSounding) return
      if (this.monoStack.length === 0) {
        this.releaseNoteVoices(note)
        return
      }
      // Last-note-priority fallback: re-sound the next most recently held
      // note, gliding from the one just released when Glide is on.
      const fallbackNote = this.monoStack[this.monoStack.length - 1]
      this.stopAllVoicesImmediate()
      const matches = this.collectMatchingZones(fallbackNote, this.lastVelocity)
      if (matches.length === 0) return
      const glideFromNote = preset.glide?.enabled ? note : null
      void this.spawnVoicesForNote(fallbackNote, this.lastVelocity, matches, glideFromNote)
        .then((spawned) => this.activeVoices.set(String(fallbackNote), spawned))
      return
    }

    this.releaseNoteVoices(note)
  }

  /** Releases every note currently held by Latch and clears the FIFO
   * buffer -- called when the Latch toggle is switched off in the UI
   * (GlideVoicePanel.vue), since noteOff() otherwise never releases a
   * latched note on its own. */
  releaseAllLatched(): void {
    for (const note of this.latchQueue) this.releaseNoteVoices(note)
    this.latchQueue = []
  }

  pitchBend(semitonesRange: number, value01: number): void {
    // value01: -1..1. Applied at next note-on for simplicity in v1; live
    // re-pitching of already-sounding voices is a nice-to-have deferred
    // to polish.
    this.pitchBendSemitonesValue = value01 * semitonesRange
  }

  modWheel(value01: number): void {
    this.modWheelSignal.value = Math.min(1, Math.max(0, value01))
  }

  /** value01: -1..1, matches AudioEngine.pitchBend()'s range -- this is the
   * *live* mod-matrix source (Manual.pdf p.157's "Pitch Wheel"), separate
   * from the static per-voice retune pitchBend() already applies. */
  pitchWheelLive(value01: number): void {
    this.pitchWheelSignal.value = Math.min(1, Math.max(-1, value01))
  }

  channelPressure(value01: number): void {
    this.pressureSignal.value = Math.min(1, Math.max(0, value01))
  }

  getCCSignal(cc: number): Tone.Signal<'normalRange'> {
    let signal = this.ccSignals.get(cc)
    if (!signal) {
      signal = new Tone.Signal({ value: 0, units: 'normalRange' })
      this.ccSignals.set(cc, signal)
    }
    return signal
  }

  controlChange(cc: number, value01: number): void {
    const signal = this.ccSignals.get(cc)
    if (signal) signal.value = Math.min(1, Math.max(0, value01))
  }

  panic(): void {
    for (const voices of this.activeVoices.values()) {
      for (const voice of voices) voice.forceStop()
    }
    for (const voice of this.allVoices) voice.forceStop()
    this.activeVoices.clear()
    this.allVoices.clear()
    this.heldNotes.clear()
    this.monoStack = []
    this.latchQueue = []
    this.lastNote = null
  }

  private collectMatchingZones(note: number, velocity: number) {
    const matches: Array<{ layer: import('./types').Layer; zone: import('./types').Zone }> = []
    if (!this.activePreset) return matches
    for (const layer of this.activePreset.layers) {
      for (const zone of layer.zones) {
        if (!zone.wavFile) continue // unresolved sample (e.g. placeholder index 0)
        if (note < zone.loKey || note > zone.hiKey) continue
        if (velocity < zone.loVel || velocity > zone.hiVel) continue
        matches.push({ layer, zone })
      }
    }
    return matches
  }

  private enforcePolyphony(incoming: number): void {
    // A preset with an explicit Voices setting (GlideVoicePanel.vue,
    // clamped 1-16 in the UI) uses that as its ceiling instead of the
    // engine's old global default -- absent (never opened that panel)
    // keeps today's behavior exactly.
    const limit = this.activePreset?.maxVoices != null
      ? Math.min(16, Math.max(1, this.activePreset.maxVoices))
      : this.polyphonyLimit
    const overBy = this.allVoices.size + incoming - limit
    if (overBy <= 0) return

    const candidates = [...this.allVoices]
    // Release-priority-then-oldest: releasing voices are stolen first,
    // then the overall oldest by trigger time.
    candidates.sort((a, b) => {
      if (a.isReleasing !== b.isReleasing) return a.isReleasing ? -1 : 1
      return a.triggeredAt - b.triggeredAt
    })

    for (let i = 0; i < overBy && i < candidates.length; i++) {
      candidates[i].forceStop()
      this.allVoices.delete(candidates[i])
    }
  }
}
