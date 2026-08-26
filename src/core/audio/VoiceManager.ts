// Note-on/off -> zone lookup -> spawn/release Voice. See
// docs/ARCHITECTURE.md §1.2 and §3: overlapping zones ALL sound together
// for one note-on (true layering), not just the narrowest match.
import * as Tone from 'tone'
import type { Preset } from './types'
import { Voice } from './Voice'
import type { SampleCache } from './SampleCache'

const DEFAULT_POLYPHONY = 64

export class VoiceManager {
  private activeVoices = new Map<string, Voice[]>() // key: `${note}` -> voices
  private allVoices = new Set<Voice>()
  private activePreset: Preset | null = null
  readonly modWheelSignal: Tone.Signal<'normalRange'>
  // Lazily-created per-CC live signals for Mod Matrix slots with a custom
  // `midiCC` set (see modMatrix.ts) -- same idea as modWheelSignal, but one
  // per referenced CC number instead of a single hardcoded CC1.
  private ccSignals = new Map<number, Tone.Signal<'normalRange'>>()

  private bankId: string
  private sampleCache: SampleCache
  private destination: Tone.ToneAudioNode
  private audioContext: AudioContext
  private polyphonyLimit: number
  private pitchBendSemitonesValue = 0
  // See AudioEngine.loadBank() -- true only for Sound Design-authored bank
  // data (explicit, valid filter types set via the Filter tab), never for
  // Orbit-3's auto-estimated values. See Voice.ts's build().
  private filterEnabled: boolean

  constructor(
    bankId: string,
    sampleCache: SampleCache,
    destination: Tone.ToneAudioNode,
    audioContext: AudioContext,
    filterEnabled = false,
    polyphonyLimit = DEFAULT_POLYPHONY,
  ) {
    this.bankId = bankId
    this.sampleCache = sampleCache
    this.destination = destination
    this.audioContext = audioContext
    this.filterEnabled = filterEnabled
    this.polyphonyLimit = polyphonyLimit
    this.modWheelSignal = new Tone.Signal({ value: 0, units: 'normalRange' })
  }

  setPreset(preset: Preset | null): void {
    this.panic()
    this.activePreset = preset
  }

  private heldNotes = new Set<number>()

  get activeVoiceCount(): number {
    return this.allVoices.size
  }

  get heldNoteList(): number[] {
    return [...this.heldNotes]
  }

  async noteOn(note: number, velocity: number): Promise<void> {
    if (velocity <= 0) return this.noteOff(note)
    if (!this.activePreset) return

    this.heldNotes.add(note)
    const velocity01 = Math.min(1, Math.max(0, velocity / 127))
    const matches = this.collectMatchingZones(note, velocity)
    // Temporary diagnostic -- remove once silent-preset triage is done.
    console.info(`[VoiceManager] noteOn(${note}, vel=${velocity}) preset="${this.activePreset.name}" `
      + `-> ${matches.length} matching zone(s):`, matches.map((m) => m.zone.sampleName))
    if (matches.length === 0) return

    this.enforcePolyphony(matches.length)

    const spawned: Voice[] = []
    for (const { layer, zone } of matches) {
      try {
        const voice = await Voice.create({
          bankId: this.bankId,
          layer,
          zone,
          note,
          velocity01,
          pitchBendSemitones: this.pitchBendSemitonesValue,
          sampleCache: this.sampleCache,
          modWheelSignal: this.modWheelSignal,
          getCCSignal: (cc: number) => this.getCCSignal(cc),
          filterEnabled: this.filterEnabled,
          destination: this.destination,
          audioContext: this.audioContext,
        })
        spawned.push(voice)
        this.allVoices.add(voice)
      } catch (e) {
        console.warn(`[VoiceManager] failed to spawn voice for sample "${zone.sampleName}":`, e)
      }
    }

    const key = String(note)
    const existing = this.activeVoices.get(key) ?? []
    this.activeVoices.set(key, [...existing, ...spawned])
  }

  noteOff(note: number): void {
    this.heldNotes.delete(note)
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

  pitchBend(semitonesRange: number, value01: number): void {
    // value01: -1..1. Applied at next note-on for simplicity in v1; live
    // re-pitching of already-sounding voices is a nice-to-have deferred
    // to polish.
    this.pitchBendSemitonesValue = value01 * semitonesRange
  }

  modWheel(value01: number): void {
    this.modWheelSignal.value = Math.min(1, Math.max(0, value01))
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
    const overBy = this.allVoices.size + incoming - this.polyphonyLimit
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
