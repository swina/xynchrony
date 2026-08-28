// Byte-space -> ms mapping for Glide.rate (core/audio/types.ts), used by
// Voice.ts's startGlide(). "Rate" is speed, not time -- higher = faster
// (shorter) glide, same knob-feel as Lfo.rate. Unvalidated first-pass
// curve, same caveat class as Voice.ts's rateByteToSeconds().
export function glideRateToMs(rate: number): number {
  const minMs = 10
  const maxMs = 3000
  const frac = Math.min(1, Math.max(0, Number.isFinite(rate) ? rate / 127 : 0))
  return minMs + (maxMs - minMs) * (1 - frac) ** 2
}
