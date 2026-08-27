// Resolves a Layer's Amp/Aux envelope scope (EnvelopeScope, see
// core/audio/types.ts) to the actual Envelope object that should sound --
// used by both Voice.ts (playback) and EnvelopeScopeEditor.vue (editing),
// so the two can never disagree about which envelope is "live" for a
// layer. Falls back to the layer's own envelope whenever the referenced
// group/global envelope doesn't exist (e.g. a group was deleted, or this
// is legacy data with no scope set at all) -- never silently drops to
// "no envelope".
import type { Layer, Preset, Envelope, AuxEnvelope } from '../audio/types'

export function resolveAmpEnvelope(layer: Layer, preset: Preset): Envelope {
  const scope = layer.ampEnvScope
  if (!scope || scope.kind === 'own') return layer.ampEnv
  if (scope.kind === 'global') return preset.ampEnv ?? layer.ampEnv
  return preset.layerGroups?.find((g) => g.id === scope.groupId)?.ampEnv ?? layer.ampEnv
}

export function resolveAuxEnvelope(layer: Layer, preset: Preset): AuxEnvelope {
  const scope = layer.auxEnvScope
  if (!scope || scope.kind === 'own') return layer.auxEnv
  if (scope.kind === 'global') return preset.auxEnv ?? layer.auxEnv
  return preset.layerGroups?.find((g) => g.id === scope.groupId)?.auxEnv ?? layer.auxEnv
}
