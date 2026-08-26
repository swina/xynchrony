// Mirrors the bank.json schema produced by tools/build_bank.py (schemaVersion 2).
// See docs/ARCHITECTURE.md §1.3 for the canonical JSON shape.

export interface FilterParams {
  typeRaw: number
  typeEstimated: string
  cutoffRaw: number
  cutoffHzEstimated: number
  resonance: number
}

export interface LayerParams {
  delayMs: number
  transposeSemitones: number
  fineTuneCents: number
  nonTranspose: boolean
  volumeDb: number
  pan: number
  filter: FilterParams
}

export interface Envelope {
  attack1Rate: number
  attack1Level: number
  attack2Rate: number
  attack2Level: number
  decay1Rate: number
  sustainLevel: number
  decay2Rate: number
  decay2Level: number
  release1Rate: number
  release1Level: number
  release2Rate: number
  release2Level: number
  modeMarker: string
}

export interface AuxEnvelope extends Envelope {
  _rawStageOrder: string
}

export interface Lfo {
  rate: number
  shape: string
  delay: number
  variation: number
  sync: 'keySync' | 'freeRun'
}

export interface ModMatrixSlot {
  source: string
  destination: string
  amountPct: number
  flag: number
  // When set (0-127), this slot is driven by the given raw MIDI CC number
  // instead of `source` -- see modMatrix.ts / VoiceManager.getCCSignal().
  midiCC: number | null
}

export interface Zone {
  sampleIndex: number
  sampleName: string | null
  sampleRate: number | null
  wavFile: string | null
  rootKey: number
  loKey: number
  hiKey: number
  loVel: number
  hiVel: number
  fineTune: number
  volumeDb: number | null
  pan: number | null
  loopStart: number // sample frames
  loopEnd: number // sample frames
  isLooping: boolean
}

export interface Layer {
  layerIndex: number
  params: LayerParams
  ampEnv: Envelope
  filterEnv: Envelope
  auxEnv: AuxEnvelope
  lfo1: Lfo
  lfo2: Lfo
  modMatrix: ModMatrixSlot[]
  zones: Zone[]
}

export interface Preset {
  name: string
  category: string | null
  layers: Layer[]
}

export interface BankMeta {
  schemaVersion: number
  bankId: string
  bankName: string
  source: string
  rootKeyConvention: string
  presetCount: number
  totalLayers: number
  totalZones: number
  unresolvedSamples: number
  notes: Record<string, string>
}

export interface Bank {
  _meta: BankMeta
  presets: Record<string, Preset>
}

export interface BankManifestEntry {
  id: string
  name: string
  presetCount: number
  schemaVersion: number
  /** 'static' = served from public/data/banks (manifest.json). 'user' =
   * a Sound Design bank stored in IndexedDB (see UserBankStore). Absent
   * on raw manifest.json entries; usePresetLibrary tags them 'static'
   * when merging in user banks for BankSelector's combined list. */
  source?: 'static' | 'user'
}

export interface BankManifest {
  banks: BankManifestEntry[]
}
