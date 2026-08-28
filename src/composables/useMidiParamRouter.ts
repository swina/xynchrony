// App-level bridge from MIDI Learn CC bindings (useMidiLearn.ts) to the
// live-performance parameters they control: filter cutoff/resonance,
// filter envelope, and amp envelope. Resolved fresh against
// useAudioEngine's `currentPreset` singleton on every CC message, rather
// than through a callback a Dial registers when it mounts -- so a binding
// keeps working even if Performance mode's Filter/Envelope tab (whose
// Dials own these learnIds) has never been opened this session. Those tabs
// are v-if'd, not v-show'd (see PerformanceView.vue), so without this, a
// binding to e.g. "sd:filter:cutoff" silently did nothing until the user
// clicked into the Filter tab at least once.
//
// Deliberately NOT covering Zone/FX-node/Mod-Matrix-slot learnIds -- those
// are tied to an editing-time UI selection (which zone/node/slot is open),
// not to stable preset data, so there's no principled "current" target to
// resolve them against while their editor isn't mounted.
import { useAudioEngine } from './useAudioEngine'
import { resolveAmpEnvelope } from '../core/soundDesign/envelopeScope'
import type { Envelope } from '../core/audio/types'

interface Target {
  min: number
  max: number
  step: number
  set(v: number): void
}

// Mirrors EnvelopeEditor.vue's dial grid: stage.key + 'Rate' (0-255) for
// every stage, stage.key + 'Level' (0-127) for every stage except decay1,
// whose "level" dial is actually the envelope's sustainLevel (0-127).
function envelopeTarget(envelope: Envelope, rest: string): Target | null {
  const [stageKey, field] = rest.split(':')
  if (field === 'rate') return { min: 0, max: 255, step: 1, set: (v) => { (envelope as any)[stageKey + 'Rate'] = v } }
  if (field === 'level') return { min: 0, max: 127, step: 1, set: (v) => { (envelope as any)[stageKey + 'Level'] = v } }
  if (field === 'sustain') return { min: 0, max: 127, step: 1, set: (v) => { envelope.sustainLevel = v } }
  return null
}

function resolveTarget(learnId: string): Target | null {
  const preset = useAudioEngine().currentPreset.value
  if (!preset) return null

  if (learnId === 'sd:filter:cutoff') {
    if (!preset.filter) return null
    const filter = preset.filter
    return { min: 20, max: 20000, step: 10, set: (v) => { filter.cutoffHzEstimated = v } }
  }
  if (learnId === 'sd:filter:resonance') {
    if (!preset.filter) return null
    const filter = preset.filter
    return { min: 0, max: 127, step: 1, set: (v) => { filter.resonance = v } }
  }
  if (learnId.startsWith('sd:env:filter-envelope:')) {
    if (!preset.filterEnv) return null
    return envelopeTarget(preset.filterEnv, learnId.slice('sd:env:filter-envelope:'.length))
  }
  if (learnId.startsWith('sd:env:amp-envelope:')) {
    // Performance mode's Envelope tab defaults its layer picker to layer 0
    // (see PerformanceView.vue's selectedEnvLayerIndex); mirrored here since
    // that picker is itself just component-local UI state, not something
    // this resolver can read while the tab is unmounted.
    const layer = preset.layers[0]
    if (!layer) return null
    return envelopeTarget(resolveAmpEnvelope(layer, preset), learnId.slice('sd:env:amp-envelope:'.length))
  }
  return null
}

// Called for every incoming bound CC, regardless of whether any Dial for
// this learnId is currently mounted. No-ops for learnIds outside the set
// above (they keep working only while their owning Dial is mounted, via
// useMidiLearn.ts's valueCallbacks).
export function applyMidiParam(learnId: string, value01: number): void {
  const target = resolveTarget(learnId)
  if (!target) return
  const raw = target.min + value01 * (target.max - target.min)
  const stepped = Math.round(raw / target.step) * target.step
  const clamped = Math.min(target.max, Math.max(target.min, stepped))
  target.set(Number(clamped.toFixed(6)))
}
