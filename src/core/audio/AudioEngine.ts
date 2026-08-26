// Singleton: Tone/AudioContext lifecycle, master bus, active bank+preset
// state, one VoiceManager. See docs/ARCHITECTURE.md §3.
import * as Tone from 'tone'
import { VoiceManager } from './VoiceManager'
import { SampleCache } from './SampleCache'
import type { Bank, Preset } from './types'

class AudioEngineImpl {
  private masterGain: Tone.Gain | null = null
  private meter: Tone.Meter | null = null
  private sampleCache: SampleCache | null = null
  private voiceManager: VoiceManager | null = null
  private started = false

  private bank: Bank | null = null
  private bankId: string | null = null
  private activeBankProg: string | null = null
  private filterEnabled = false

  /** Must be called from a user-gesture handler (click/keydown) -- browsers
   * block AudioContext until one occurs. */
  async start(): Promise<void> {
    if (this.started) return
    await Tone.start()
    this.masterGain = new Tone.Gain(0.8).toDestination()
    this.meter = new Tone.Meter({ normalRange: true })
    this.masterGain.connect(this.meter)
    this.sampleCache = new SampleCache(Tone.getContext().rawContext as unknown as AudioContext)
    this.started = true
  }

  get isStarted(): boolean {
    return this.started
  }

  /** One-off, unpitched playback for auditioning a sample in the picker --
   * independent of VoiceManager/the loaded bank (no note-on, no envelope,
   * no zone lookup, just "does this sample sound like what I want"). */
  async previewSample(bankId: string, wavFile: string): Promise<void> {
    if (!this.started || !this.sampleCache || !this.masterGain) {
      console.warn('[AudioEngine] previewSample before audio started -- ignored')
      return
    }
    const buffer = await this.sampleCache.getDecodedByFile(bankId, wavFile, wavFile)
    const player = new Tone.Player(new Tone.ToneAudioBuffer(buffer)).connect(this.masterGain)
    player.onstop = () => player.dispose()
    player.start()
  }

  loadBank(bank: Bank, bankId: string): void {
    this.bank = bank
    this.bankId = bankId
    this.activeBankProg = null
    // Filter playback is only safe for bank data whose filter type/cutoff
    // were set explicitly (Sound Design's Filter tab -> real
    // BiquadFilterNode types), not auto-estimated from unvalidated raw
    // bytes (Orbit-3 and anything else) -- see Voice.ts / docs/ARCHITECTURE.md.
    this.filterEnabled = bank._meta.source === 'user-created' || bank._meta.source === 'sound-design-live-preview'
    if (this.started) {
      this.voiceManager = new VoiceManager(
        bankId,
        this.sampleCache!,
        this.masterGain!,
        Tone.getContext().rawContext as unknown as AudioContext,
        this.filterEnabled,
      )
    }
  }

  /** Returns null (not thrown) when audio hasn't started yet -- a real
   * scenario when e.g. a MIDI note arrives before the user has clicked
   * anything, since MIDI input isn't a browser "user gesture" that can
   * unlock the AudioContext. Callers should no-op quietly in that case;
   * the UI prompts for an explicit gesture separately (App.vue). */
  private tryGetVoiceManager(): VoiceManager | null {
    if (!this.started) return null
    return this.ensureVoiceManager()
  }

  private ensureVoiceManager(): VoiceManager {
    if (!this.started) throw new Error('AudioEngine.start() must be called first (from a user gesture)')
    if (!this.voiceManager) {
      if (!this.bankId) throw new Error('No bank loaded')
      this.voiceManager = new VoiceManager(
        this.bankId,
        this.sampleCache!,
        this.masterGain!,
        Tone.getContext().rawContext as unknown as AudioContext,
        this.filterEnabled,
      )
      if (this.currentPreset) this.voiceManager.setPreset(this.currentPreset)
    }
    return this.voiceManager
  }

  /** Safe to call before start() -- browsing/selecting a preset shouldn't
   * require an AudioContext-unlocking user gesture; only actually
   * triggering a note does. The selection is applied to the VoiceManager
   * once audio has started (here, or lazily in tryGetVoiceManager()). */
  setPreset(bankProg: string): void {
    if (!this.bank) throw new Error('No bank loaded')
    const preset: Preset | undefined = this.bank.presets[bankProg]
    if (!preset) throw new Error(`Preset ${bankProg} not found in loaded bank`)
    this.activeBankProg = bankProg
    this.tryGetVoiceManager()?.setPreset(preset)
  }

  get currentPreset(): Preset | null {
    if (!this.bank || !this.activeBankProg) return null
    return this.bank.presets[this.activeBankProg] ?? null
  }

  get currentBankProg(): string | null {
    return this.activeBankProg
  }

  noteOn(note: number, velocity: number): void {
    const vm = this.tryGetVoiceManager()
    if (!vm) {
      console.warn('[AudioEngine] noteOn before audio started -- ignored (needs a user gesture first)')
      return
    }
    void vm.noteOn(note, velocity)
  }

  noteOff(note: number): void {
    this.voiceManager?.noteOff(note)
  }

  pitchBend(value01: number): void {
    this.voiceManager?.pitchBend(2, value01)
  }

  modWheel(value01: number): void {
    this.voiceManager?.modWheel(value01)
  }

  controlChange(cc: number, value01: number): void {
    this.voiceManager?.controlChange(cc, value01)
  }

  panic(): void {
    this.voiceManager?.panic()
  }

  get activeVoiceCount(): number {
    return this.voiceManager?.activeVoiceCount ?? 0
  }

  get heldNotes(): number[] {
    return this.voiceManager?.heldNoteList ?? []
  }

  /** 0..1 normalized level, or 0 if not started. Cheap to poll from the UI. */
  getMeterLevel(): number {
    if (!this.meter) return 0
    const value = this.meter.getValue()
    const level = Array.isArray(value) ? value[0] : value
    return typeof level === 'number' && Number.isFinite(level) ? Math.max(0, level) : 0
  }

  setMasterVolume(volume01: number): void {
    if (this.masterGain) this.masterGain.gain.value = Math.min(1, Math.max(0, volume01))
  }

  clearAudioCache(): Promise<void> | undefined {
    return this.sampleCache?.clearPersistentCache()
  }
}

// Module-level singleton (plain composable pattern, no Pinia -- see
// docs/ARCHITECTURE.md / the approved plan's stack-discipline note).
export const AudioEngine = new AudioEngineImpl()
