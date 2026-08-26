// Mirrors the enum tables in tools/build_bank.py verbatim (SOURCE_IDS,
// DEST_IDS, LFO_SHAPES) so unrecognized "raw:0xNN" strings stay meaningful
// on both sides. See docs/ARCHITECTURE.md §1.1.

export const KNOWN_MOD_SOURCES = [
  'filterEnv', 'lfo1Bipolar', 'lfo1Unipolar', 'lfo2Bipolar', 'lfo2Unipolar',
  'velocity', 'modWheel',
] as const

export const KNOWN_MOD_DESTINATIONS = [
  'pitch', 'filterFreq', 'filterQ', 'volEnvDecay', 'lfo1Rate', 'lfo2Rate',
  'velocityDefault',
] as const

export const LFO_SHAPES = ['triangle', 'sine', 'sawtooth', 'square'] as const

export function isRawId(value: string): boolean {
  return value.startsWith('raw:0x')
}
