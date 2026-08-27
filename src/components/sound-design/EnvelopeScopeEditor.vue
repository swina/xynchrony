<script setup lang="ts">
// Wraps EnvelopeEditor.vue with a scope selector: a layer's Amp/Aux
// envelope can be its own (default, today's behavior), shared with a
// named group of layers, or shared across the whole patch -- see
// core/audio/types.ts's EnvelopeScope and
// core/soundDesign/envelopeScope.ts's resolver, which this uses the exact
// same logic as (so editing here always shows what Voice.ts will actually
// play). Real Emulator X3 envelopes are per-voice with a "select several
// voices, edit together" convenience (Manual.pdf p.93/p.132) rather than a
// literal shared object -- this replicates the effect the user asked for
// (edit once, every layer in the group sounds it) since that's simpler to
// build and reason about than re-deriving a multi-selection at playback
// time.
import { computed } from 'vue'
import type { Layer, Preset } from '../../core/audio/types'
import { resolveAmpEnvelope, resolveAuxEnvelope } from '../../core/soundDesign/envelopeScope'
import { blankEnvelope, blankAuxEnvelope, blankLayerGroup } from '../../core/soundDesign/defaults'
import EnvelopeEditor from './EnvelopeEditor.vue'
import { Pencil, X } from '@lucide/vue'

const props = defineProps<{ layer: Layer; preset: Preset; kind: 'amp' | 'aux'; title: string }>()

const scope = computed(() => (props.kind === 'amp' ? props.layer.ampEnvScope : props.layer.auxEnvScope) ?? { kind: 'own' as const })

const resolvedEnvelope = computed(() =>
  props.kind === 'amp' ? resolveAmpEnvelope(props.layer, props.preset) : resolveAuxEnvelope(props.layer, props.preset),
)

const activeGroup = computed(() => {
  const s = scope.value
  if (s.kind !== 'group') return null
  return props.preset.layerGroups?.find((g) => g.id === s.groupId) ?? null
})

// The <select>'s value: 'own', 'global', or a group id -- 'new' is handled
// specially in onSelect rather than being a real persisted value.
const selectValue = computed(() => (scope.value.kind === 'group' ? scope.value.groupId : scope.value.kind))

type Scope = { kind: 'own' } | { kind: 'global' } | { kind: 'group'; groupId: string }

function setLayerScope(layer: Layer, kind: 'amp' | 'aux', next: Scope) {
  if (kind === 'amp') layer.ampEnvScope = next
  else layer.auxEnvScope = next
}

function onSelect(raw: string) {
  if (raw === 'own') {
    setLayerScope(props.layer, props.kind, { kind: 'own' })
  } else if (raw === 'global') {
    if (props.kind === 'amp') props.preset.ampEnv ??= blankEnvelope()
    else props.preset.auxEnv ??= blankAuxEnvelope()
    setLayerScope(props.layer, props.kind, { kind: 'global' })
  } else if (raw === 'new') {
    const name = prompt('New group name')
    if (!name || !name.trim()) return
    const group = blankLayerGroup(name.trim())
    props.preset.layerGroups ??= []
    props.preset.layerGroups.push(group)
    setLayerScope(props.layer, props.kind, { kind: 'group', groupId: group.id })
  } else {
    setLayerScope(props.layer, props.kind, { kind: 'group', groupId: raw })
  }
}

function renameGroup() {
  const group = activeGroup.value
  if (!group) return
  const name = prompt('Rename group', group.name)
  if (!name || !name.trim()) return
  group.name = name.trim()
}

// Removing a group resets every layer (not just this one) pointing at it
// for this envelope kind back to "own" -- each layer's own envelope data
// was never touched while it was on group scope, so nothing is lost.
function removeGroup() {
  const group = activeGroup.value
  if (!group) return
  if (!confirm(`Remove group "${group.name}"? Layers using it fall back to their own ${props.kind === 'amp' ? 'Amp' : 'Aux'} Envelope.`)) return
  props.preset.layerGroups = (props.preset.layerGroups ?? []).filter((g) => g.id !== group.id)
  for (const l of props.preset.layers) {
    const s = props.kind === 'amp' ? l.ampEnvScope : l.auxEnvScope
    if (s?.kind === 'group' && s.groupId === group.id) setLayerScope(l, props.kind, { kind: 'own' })
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2 text-xs sd-panel py-2">
      <span style="color: var(--color-ink-soft)">Scope</span>
      <select :value="selectValue" class="sd-input text-xs flex-1" @change="onSelect(($event.target as HTMLSelectElement).value)">
        <option value="own">This layer only</option>
        <option value="global">Whole patch</option>
        <option v-for="g in preset.layerGroups ?? []" :key="g.id" :value="g.id">Group: {{ g.name }}</option>
        <option value="new">+ New group&hellip;</option>
      </select>
      <template v-if="activeGroup">
        <button class="sd-btn sd-btn-icon" title="Rename group" @click="renameGroup"><Pencil :size="14" /></button>
        <button class="sd-btn sd-btn-icon sd-btn-danger" title="Remove group" @click="removeGroup"><X :size="14" /></button>
      </template>
    </div>
    <EnvelopeEditor :envelope="resolvedEnvelope" :title="title" />
  </div>
</template>
