// Shared byte-space -> Tone.js mapping for Lfo.rate/shape, used by both
// Voice.ts (one LFO1/2 pair per voice, from the triggering Layer) and
// VoiceManager.ts (one shared LFO1/2 pair per active preset, from
// Preset.lfo1/lfo2 -- see docs/plans/FX-Modulations.md). Extracted rather
// than duplicated so the two stay identical by construction.
import type * as Tone from 'tone'

export function lfoRateToHz(rate: number): number {
  // 0-127 -> roughly 0.05Hz .. 20Hz, exponential (unvalidated, same caveat
  // class as the envelope rate mapping in Voice.ts).
  const frac = Math.min(1, Math.max(0, rate / 127))
  return 0.05 * (400 ** frac)
}

export function lfoShapeToType(shape: string): Tone.ToneOscillatorType {
  switch (shape) {
    case 'sine': return 'sine'
    case 'sawtooth': return 'sawtooth'
    case 'square': return 'square'
    case 'triangle':
    default:
      return 'triangle'
  }
}
