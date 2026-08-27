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

// Real Emulator X3 envelopes are per-voice (Manual.pdf p.132: "three
// envelope generators per voice") -- there's no hardware "shared envelope"
// concept, only a per-editing-session "select several voices, edit them
// together" convenience (Manual.pdf p.93's Groups). We replicate the
// *effect* the user actually wants (edit one envelope, every layer in the
// group sounds it) as a true shared object instead, since it's simpler to
// build correctly and to reason about than re-deriving "which voices are
// currently multi-selected" at playback time. `kind: 'own'` (the default
// when a Layer's *EnvScope field is unset) keeps today's per-layer
// behavior unchanged.
export type EnvelopeScope =
  | { kind: 'own' }
  | { kind: 'group'; groupId: string }
  | { kind: 'global' }

// A named, shared Amp/Aux envelope pair that any number of Layers in the
// same Preset can point their ampEnvScope/auxEnvScope at independently --
// see resolveAmpEnvelope()/resolveAuxEnvelope() in
// core/soundDesign/envelopeScope.ts.
export interface LayerGroup {
  id: string
  name: string
  ampEnv: Envelope
  auxEnv: AuxEnvelope
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
  // This layer's own envelope data -- always present and always kept
  // up to date even when ampEnvScope/auxEnvScope points elsewhere, so
  // switching back to "own" never loses anything. See EnvelopeScope above.
  ampEnv: Envelope
  auxEnv: AuxEnvelope
  // Undefined = { kind: 'own' } (today's per-layer behavior). See
  // core/soundDesign/envelopeScope.ts for how these resolve to an actual
  // Envelope object.
  ampEnvScope?: EnvelopeScope
  auxEnvScope?: EnvelopeScope
  lfo1: Lfo
  lfo2: Lfo
  modMatrix: ModMatrixSlot[]
  zones: Zone[]
}

export interface Preset {
  name: string
  category: string | null
  layers: Layer[]
  // Patch-level global filter -- one filter per preset, not per layer (see
  // docs/plans/sound-design-ui.md). Optional because Orbit-3's bank.json
  // (tools/build_bank.py, schemaVersion 2) predates this and has no
  // preset-level filter data -- only per-layer estimates, which were never
  // reliable enough to play back (see docs/ARCHITECTURE.md) and Voice.ts no
  // longer reads. Every Sound Design-created or -duplicated preset always
  // has both fields set -- see UserBankStore.ts.
  filter?: FilterParams
  filterEnv?: Envelope
  // User-facing on/off toggle (FilterPanel.vue's "Enable filter" checkbox,
  // both Sound Design's and Performance mode's) -- defaults to true
  // (bypassed/off), see UserBankStore.duplicatePresetInto()'s comment for
  // why a fresh/duplicated preset always starts silent-safe rather than
  // active-but-nominally-transparent.
  filterBypassed?: boolean
  // Whole-patch Amp/Aux envelopes -- targets for ampEnvScope/auxEnvScope's
  // `{ kind: 'global' }` (see EnvelopeScope above). Optional/lazily seeded
  // the same way filter/filterEnv are (FilterPanel.vue's pattern) --
  // absent until a layer actually chooses "whole patch" scope.
  ampEnv?: Envelope
  auxEnv?: AuxEnvelope
  // Named shared envelope groups a layer can opt into per envelope type
  // (`{ kind: 'group'; groupId }`) -- see EnvelopeScope above.
  layerGroups?: LayerGroup[]
  // Preset FX: an arbitrary graph of effect nodes wired by cable (Input ->
  // node(s) -> Output, parallel branches allowed), shared by every voice of
  // this preset -- see core/audio/effects.ts and docs/plans/FX-Modulations.md.
  // Optional/absent for Orbit-3 data (no equivalent); VoiceManager falls
  // back to blankFxChain() (fully dry passthrough) when unset, so this is
  // safe to leave undefined until the FX patch editor lazily seeds it.
  fx?: FxChain
  // Patch-level Mod Matrix routings -- applied to every layer's voices in
  // addition to that layer's own `modMatrix`, not instead of it (see
  // docs/plans/FX-Modulations.md's Modulation "Option B"). Optional/absent
  // until the Modulation patch editor lazily seeds it, same pattern as `fx`.
  modMatrix?: ModMatrixSlot[]
  // Patch-level LFO pair, independent of any layer's own lfo1/lfo2 --
  // sources for the Modulation patch editor's `patchLfo1`/`patchLfo2`
  // routings (core/audio/modMatrix.ts). One shared Tone.LFO instance per
  // active preset (VoiceManager), not one per voice -- see VoiceManager.ts.
  // Only `rate`/`shape` are actually wired to audio, same documented scope
  // as every layer's own lfo1/lfo2 (Voice.ts) -- `delay`/`variation`/`sync`
  // are stored/editable but not yet applied to playback.
  lfo1?: Lfo
  lfo2?: Lfo
}

// Effect algorithm catalog -- data shapes only; the actual Tone.js node
// construction (EffectChain, buildSlotNode) lives in core/audio/effects.ts,
// which imports these rather than the other way around, matching every
// other data shape in this file. Real Emulator X3 has 16 algorithms
// (Manual.pdf p.244-260); this app implements 6 -- see ARCHITECTURE.md.
export const EFFECT_ALGORITHMS = ['reverb', 'delay', 'chorus', 'eq4', 'compressor', 'phaser'] as const
export type EffectAlgorithm = (typeof EFFECT_ALGORITHMS)[number]

// One instance of an effect algorithm, placed on the FX patch canvas -- see
// docs/plans/FX-Modulations.md's "FX Chain patching". Deleting a node
// removes it from `FxChain.nodes` entirely (no 'off' algorithm placeholder
// needed anymore, unlike the old fixed-2-slot model this replaced).
export interface FxNode {
  id: string
  algorithm: EffectAlgorithm
  params: Record<string, number>
  wetDry: number // 0-100, this node's own dry/wet mix (default 100 = fully wet)
  // Bypasses this node's processing entirely (fully dry passthrough) without
  // touching its cables or its `wetDry` value -- distinct from dialing
  // wetDry to 0, which is audibly identical but loses whatever mix the user
  // had dialed in when they want it back. Optional/absent = false (not
  // bypassed, i.e. active) -- opposite default sense from
  // Preset.filterBypassed (which defaults to true/bypassed), so a freshly
  // added node is audible immediately.
  bypass?: boolean
  position: { x: number; y: number } // canvas layout, persisted with the chain
}

// A cable: `from`/`to` are FxNode ids, or the literal 'input'/'output'
// pseudo-node ids representing the chain's own dry signal in / summed wet
// bus out. Multiple edges into one node's `to` sum (Web Audio fan-in);
// multiple edges out of one node's `from` fan out (parallel branches).
export interface FxEdge {
  id: string
  from: string
  to: string
}

export interface FxChain {
  nodes: FxNode[]
  edges: FxEdge[]
  wetDry: number // 0-100, overall chain mix: dry input vs. the summed 'output' bus
  // dB, capped at 0 (unity) -- never a boost, only attenuation. Applied
  // between the chain's Input jack and whatever's cabled from it (i.e. the
  // wet/processing path only, not the dry path the overall Mix above blends
  // against) -- see core/audio/effects.ts's EffectChain. Required like
  // `wetDry`, but read defensively (`?? 0`) wherever consumed since a chain
  // saved before this field existed won't have it at runtime despite the type.
  inputGainDb: number
  // Canvas position of the Input/Output pseudo-nodes -- UI layout only, the
  // engine never reads these (routing is purely topological via `edges`).
  // Optional/lazily-seeded (FxChainEditor.vue) for the same reason as above.
  inputPosition?: { x: number; y: number }
  outputPosition?: { x: number; y: number }
}

// A named, reusable FX or Modulation chain, independent of any Bank/Preset
// -- see docs/plans/FX-Modulations.md's "FX / Modulation preset library"
// and core/data/FxModPresetStore.ts. Applying one deep-clones `slots`/
// `lfo1`/`lfo2` (or the FxChain) onto the active preset -- never shares the
// object the library entry owns.
export interface ModulationPreset {
  slots: ModMatrixSlot[]
  lfo1: Lfo
  lfo2: Lfo
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
