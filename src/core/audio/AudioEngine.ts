// Singleton: Tone/AudioContext lifecycle, master bus, active bank+preset
// state, one VoiceManager. See docs/ARCHITECTURE.md §3.
import * as Tone from 'tone'
import { VoiceManager } from './VoiceManager'
import { SampleCache } from './SampleCache'
import { EffectChain, blankFxChain, type FxChain } from './effects'
import type { Bank, Preset } from './types'

class AudioEngineImpl {
  private masterGain: Tone.Gain | null = null
  private meter: Tone.Meter | null = null
  private sampleCache: SampleCache | null = null
  private voiceManager: VoiceManager | null = null
  // Global/Aux FX: one chain on the master bus, independent of whichever
  // preset is loaded -- see core/audio/effects.ts and docs/ARCHITECTURE.md.
  // Real Emulator X3's Aux FX applies across all 64 MIDI channels
  // (Manual.pdf p.231-235); this app only ever plays one preset at a time,
  // so "applies globally" maps onto "one always-on chain on the master
  // bus" rather than any per-channel concept this app doesn't have.
  private globalFxChain: EffectChain | null = null
  private started = false
  // Global BPM for patch-level LFO tempo-sync -- see useGlobalTempo.ts.
  // Stored here (not only on VoiceManager) so a VoiceManager created later
  // (loadBank()/ensureVoiceManager()) picks up whatever was last set,
  // same reasoning as globalFxChain surviving a preset swap.
  private bpm = 120

  private bank: Bank | null = null
  private bankId: string | null = null
  private activeBankProg: string | null = null

  /** Must be called from a user-gesture handler (click/keydown) -- browsers
   * block AudioContext until one occurs. */
  async start(): Promise<void> {
    if (this.started) return
    await Tone.start()
    // masterGain -> globalFxChain -> destination; meter taps the FX
    // chain's output so the VU meter reflects final audible output, not
    // pre-FX signal.
    this.masterGain = new Tone.Gain(0.8)
    this.globalFxChain = new EffectChain()
    this.globalFxChain.rebuild(blankFxChain())
    this.masterGain.connect(this.globalFxChain.input)
    this.globalFxChain.output.toDestination()
    this.meter = new Tone.Meter({ normalRange: true })
    this.globalFxChain.output.connect(this.meter)
    this.sampleCache = new SampleCache(Tone.getContext().rawContext as unknown as AudioContext)
    this.started = true
  }

  /** Rebuilds the Global/Aux FX chain from `config` -- see
   * useGlobalFx.ts, which calls this whenever its persisted config
   * changes. No-op before start() (nothing to rebuild yet; useGlobalFx
   * re-applies once started). */
  setGlobalFx(config: FxChain): void {
    this.globalFxChain?.rebuild(config)
  }

  /** Rebuilds patch-level LFO rates for any active tempo-synced LFO --
   * see useGlobalTempo.ts, which calls this whenever the persisted BPM
   * changes. Safe to call before start()/loadBank() -- just stored for
   * whichever VoiceManager exists later. */
  setGlobalTempo(bpm: number): void {
    this.bpm = bpm
    this.voiceManager?.setBpm(bpm)
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
    if (this.started) {
      this.voiceManager = new VoiceManager(
        bankId,
        this.sampleCache!,
        this.masterGain!,
        Tone.getContext().rawContext as unknown as AudioContext,
      )
      this.voiceManager.setBpm(this.bpm)
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
      )
      this.voiceManager.setBpm(this.bpm)
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

  /** Re-applies the active preset's `fx`, patch-level `lfo1`/`lfo2`, and
   * `filter`/`filterEnv`/`filterBypassed` onto the running audio graph,
   * without stopping held notes -- see useAudioEngine.ts, which calls this
   * whenever the current preset is edited live (Sound Design's FX/
   * Modulation/Filter tabs, Performance mode's FX/Modulation/Filter panes).
   * `preset.modMatrix`/layer `modMatrix` routing changes need no equivalent
   * call -- they're read fresh at each note-on (Voice.ts), same as they
   * always have been. */
  refreshPresetLive(): void {
    this.voiceManager?.refreshFx()
    this.voiceManager?.refreshPatchLfo()
    this.voiceManager?.refreshFilter()
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
    // Also feeds the live Mod Matrix "Pitch Wheel" source -- separate from
    // the static per-voice retune above (Manual.pdf p.157).
    this.voiceManager?.pitchWheelLive(value01)
  }

  modWheel(value01: number): void {
    this.voiceManager?.modWheel(value01)
  }

  channelPressure(value01: number): void {
    this.voiceManager?.channelPressure(value01)
  }

  controlChange(cc: number, value01: number): void {
    this.voiceManager?.controlChange(cc, value01)
  }

  panic(): void {
    this.voiceManager?.panic()
  }

  /** Releases every note Latch is currently holding -- called when the
   * Latch toggle is switched off (GlideVoicePanel.vue), since a latched
   * note's key-up otherwise never releases it on its own. */
  releaseAllLatched(): void {
    this.voiceManager?.releaseAllLatched()
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
