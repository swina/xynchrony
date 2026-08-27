// Mirrors the enum tables in tools/build_bank.py verbatim (SOURCE_IDS,
// DEST_IDS, LFO_SHAPES) so unrecognized "raw:0xNN" strings stay meaningful
// on both sides. See docs/ARCHITECTURE.md §1.1.

export const KNOWN_MOD_SOURCES = [
  'filterEnv', 'lfo1Bipolar', 'lfo1Unipolar', 'lfo2Bipolar', 'lfo2Unipolar',
  'velocity', 'modWheel',
  // Practical additions beyond what tools/build_bank.py decodes from
  // Orbit-3 -- live for Sound Design presets only. See Manual.pdf p.156-160
  // and docs/ARCHITECTURE.md for the full real-hardware source list this
  // was drawn from (most of it -- Function Generators, Lag Processors,
  // Poly Key Timer, Clock Divisors, etc. -- is out of scope for now).
  'pitchWheel', 'key', 'gate', 'pressure',
  // Patch-level LFO pair (Preset.lfo1/lfo2, one shared instance per active
  // preset) -- distinct from lfo1Bipolar/lfo2Bipolar above, which are each
  // layer's own per-voice LFO. See docs/plans/FX-Modulations.md.
  'patchLfo1', 'patchLfo2',
] as const

export const KNOWN_MOD_DESTINATIONS = [
  'pitch', 'filterFreq', 'filterQ', 'volEnvDecay', 'lfo1Rate', 'lfo2Rate',
  'velocityDefault',
  // Targets the new Preset FX chain's overall Wet/Dry -- see
  // core/audio/effects.ts. Sound Design presets only (no effect chain
  // exists for a preset without one).
  'wetDryMix',
] as const

export const LFO_SHAPES = ['triangle', 'sine', 'sawtooth', 'square'] as const

export function isRawId(value: string): boolean {
  return value.startsWith('raw:0x')
}
