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

// Tempo-sync divisions for patch-level LFOs (Preset.lfo1/lfo2 with
// rateMode === 'sync') -- docs/plans/Modulation-Plan.md's "1/128 to 8/1"
// range. Whole-note-relative: e.g. '1/4' = one quarter note per cycle,
// '2/1' = one cycle every 2 whole notes (very slow).
export const SYNC_DIVISIONS = [
  '1/128', '1/64', '1/32', '1/16', '1/8', '1/4', '1/2', '1/1', '2/1', '4/1', '8/1',
] as const
export type SyncDivision = (typeof SYNC_DIVISIONS)[number]

// Byte -> seconds/depth mappings for patch-level LFO Delay/Variation,
// applied per-voice in modMatrix.ts (the shared oscillator itself can't
// have per-note timing without affecting every other held note using it)
// -- see docs/plans/Modulation-Plan.md.
export function lfoDelayByteToSeconds(delay: number): number {
  const frac = Math.min(1, Math.max(0, delay / 127))
  return frac * 5 // 0..5s ramp-in before this voice's routing reaches full depth
}

export function lfoVariationByteToDepth(variation: number): number {
  const frac = Math.min(1, Math.max(0, variation / 127))
  return frac * 0.3 // 0..30% random per-voice depth jitter
}

export function syncDivisionToHz(division: string, bpm: number): number {
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120
  const wholeNoteSec = (60 / safeBpm) * 4
  const [numRaw, denRaw] = division.split('/')
  const num = Number(numRaw), den = Number(denRaw)
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return lfoRateToHz(64) // malformed division -- safe mid-range fallback, never NaN/0 onto a live AudioParam
  const durationSec = wholeNoteSec * (num / den)
  return 1 / durationSec
}
