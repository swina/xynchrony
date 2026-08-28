<script setup lang="ts">
// Patch-level Modulation panel: a source/destination node canvas -- unlike
// FxChainEditor's free-form graph, the node *catalog* is fixed/known (not
// user-defined algorithms), but node *presence* is opt-in: the canvas
// starts empty and the user adds a Source or Destination node by picking
// from a combo, same interaction shape as FxChainEditor's "Add node"
// combo. Only cables, custom MIDI sources, and which nodes are placed are
// user content. A cable = one ModMatrixSlot on `preset.modMatrix`, applied
// to every layer's voices on top of that layer's own routings -- see
// docs/plans/Modulation-Plan.md and core/audio/modMatrix.ts.
import { ref, computed, watch, onMounted } from 'vue'
import { blankLfo } from '../../core/soundDesign/defaults'
import { useFxModLibrary } from '../../composables/useFxModLibrary'
import { deepClonePlain } from '../../utils/deepClone'
import { newId } from '../../utils/id'
import type { Preset, ModMatrixSlot, CustomMidiSource } from '../../core/audio/types'
import Dial from './Dial.vue'
import LfoEditor from './LfoEditor.vue'
import PatchCable from './PatchCable.vue'
import PatchCanvasFrame from './PatchCanvasFrame.vue'
import { X, Save, FolderOpen, Maximize2, Minimize2 } from '@lucide/vue'

const props = defineProps<{ preset: Preset }>()

// Fixed catalogs the "Add Source"/"Add Destination" combos pick from --
// see docs/plans/Modulation-Plan.md. `pitch`/`sampleStart`/`envAttack`/
// `envDecay`/`envSustain`/`envRelease` are one-time-at-note-on only
// (modMatrix.ts's ONE_TIME_ONLY_DESTINATIONS); `patchLfo1Rate`/
// `patchLfo2Rate` target the shared patch-level LFO pair, distinct from
// `lfo1Rate`/`lfo2Rate` (those target each layer's own per-voice LFO --
// omitted here, use the per-layer ModMatrixEditor.vue for that). Custom
// MIDI sources aren't in this list -- unlimited, added via their own
// combo entry (see FIXED_SOURCE_TYPES below).
const DEST_ORDER = [
  'filterFreq', 'filterQ', 'ampVolume', 'ampPan', 'pitch', 'sampleStart',
  'envAttack', 'envDecay', 'envSustain', 'envRelease',
  'patchLfo1Rate', 'patchLfo2Rate', 'glideRate', 'wetDryMix',
] as const

const DEST_LABELS: Record<string, string> = {
  filterFreq: 'Filter Freq', filterQ: 'Filter Q',
  ampVolume: 'Amp Volume', ampPan: 'Amp Pan', pitch: 'Pitch', sampleStart: 'Sample Start',
  envAttack: 'Env Attack', envDecay: 'Env Decay', envSustain: 'Env Sustain', envRelease: 'Env Release',
  patchLfo1Rate: 'LFO 1 Freq', patchLfo2Rate: 'LFO 2 Freq', glideRate: 'Glide Rate', wetDryMix: 'FX Wet/Dry',
}
const SOURCE_LABELS: Record<string, string> = {
  patchLfo1: 'LFO 1 (patch)', patchLfo2: 'LFO 2 (patch)',
  pitchWheel: 'Pitch Wheel', modWheel: 'Mod Wheel', key: 'Key', gate: 'Gate', pressure: 'Pressure', velocity: 'Velocity',
}
// "Assignable CC" for these (docs/plans/Modulation-Plan.md) is already
// satisfied by the existing per-cable `midiCC` override field below -- no
// per-source CC assignment needed on top of that.
const FIXED_SOURCE_TYPES = ['patchLfo1', 'patchLfo2', 'pitchWheel', 'modWheel', 'key', 'gate', 'pressure', 'velocity']
const CUSTOM_SOURCE_OPTION = '__custom__'

const availableSourceTypes = computed(() => FIXED_SOURCE_TYPES.filter((id) => !(props.preset.modulationNodes?.sources.includes(id))))
const availableDestTypes = computed(() => DEST_ORDER.filter((id) => !(props.preset.modulationNodes?.destinations.includes(id))))

// -- Layout: `preset.modulationLayout[id]` stores each node's top-left
// position (draggable -- "every node can be dragged/moved" per
// docs/plans/Modulation-Plan.md). A source node is SOURCE_JACK_OFFSET_X
// wide with its jack dot at its right edge; a destination node's jack dot
// sits at its own left edge (the jack is the node's first flex child).
const SOURCE_X = 8
const SOURCE_JACK_OFFSET_X = 224 // node width (LFO editor's w-56 / plain-source row) -- jack dot x = node.x + this
const DEST_X = 420
const ROW_HEIGHT_GUESS = 48 // default vertical stacking gap for newly-added nodes; purely a placement convenience, not exact (nodes are draggable after)
const JACK_DOT_Y_OFFSET = 20 // vertical offset of a node's jack dot from its own top

function nextDefaultPos(existingCount: number, x: number): { x: number; y: number } {
  return { x, y: 8 + existingCount * ROW_HEIGHT_GUESS }
}

watch(() => props.preset, (preset) => {
  preset.modMatrix ??= []
  preset.lfo1 ??= blankLfo()
  preset.lfo2 ??= blankLfo()
  preset.customMidiSources ??= []
  preset.modulationLayout ??= {}
  // Lazy migration: a preset saved before this opt-in canvas existed (or
  // before this session) may already have `modMatrix` cables referencing
  // nodes that were previously always shown -- seed their visible nodes
  // from those cables once, so existing routings never lose their nodes.
  // A brand-new preset gets an empty canvas, matching "do not add all
  // sources/destinations" -- the user places nodes explicitly from here on.
  if (!preset.modulationNodes) {
    const sources = [...new Set(preset.modMatrix.map((s) => s.source))]
    const destinations = [...new Set(preset.modMatrix.map((s) => s.destination))]
    sources.forEach((id, i) => { preset.modulationLayout![id] ??= nextDefaultPos(i, SOURCE_X) })
    destinations.forEach((id, i) => { preset.modulationLayout![id] ??= nextDefaultPos(i, DEST_X) })
    preset.modulationNodes = { sources, destinations }
  }
}, { immediate: true })

/** A node's top-left position -- what's dragged and persisted. */
function panelPos(id: string): { x: number; y: number } {
  return props.preset.modulationLayout?.[id] ?? { x: SOURCE_X, y: 8 }
}
/** Cable-endpoint pixel position for a source node's jack dot (right edge). */
function sourceDotPos(id: string): { x: number; y: number } {
  const p = panelPos(id)
  return { x: p.x + SOURCE_JACK_OFFSET_X, y: p.y + JACK_DOT_Y_OFFSET }
}
/** Cable-endpoint pixel position for a destination node's jack dot (left edge). */
function destDotPos(id: string): { x: number; y: number } {
  const p = panelPos(id)
  return { x: p.x, y: p.y + JACK_DOT_Y_OFFSET }
}

// Free-form node positions (unlike the old fixed jack panel) mean canvas
// extent has to track actual placed nodes rather than a fixed catalog
// length -- generous per-node headroom since an expanded LFO node is much
// taller than a collapsed one.
const canvasHeight = computed(() => {
  const layout = props.preset.modulationLayout ?? {}
  const ids = [...(props.preset.modulationNodes?.sources ?? []), ...(props.preset.modulationNodes?.destinations ?? [])]
  let maxY = 200
  for (const id of ids) maxY = Math.max(maxY, (layout[id]?.y ?? 0) + 220)
  return maxY
})

const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}%`
const canvasEl = ref<HTMLElement | null>(null)
const selectedIndex = ref<number | null>(null)

// -- Node drag (position only) -- same mechanics as FxChainEditor.vue's
// startPositionDrag(), reused here for source/destination nodes.
function startPositionDrag(id: string, ev: PointerEvent) {
  if ((ev.target as HTMLElement).closest('.sd-dial-wrap, button, select, input')) return
  const layout = props.preset.modulationLayout!
  layout[id] ??= { x: SOURCE_X, y: 8 }
  const position = layout[id]
  ev.preventDefault()
  const startX = ev.clientX, startY = ev.clientY
  const origX = position.x, origY = position.y
  function onMove(e: PointerEvent) {
    position.x = Math.max(0, origX + (e.clientX - startX))
    position.y = Math.max(0, origY + (e.clientY - startY))
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// -- Cable drag: source jack -> destination jack -----------------------
const pending = ref<{ from: string; x: number; y: number } | null>(null)

function startCable(fromId: string, ev: PointerEvent) {
  ev.preventDefault()
  ev.stopPropagation()
  const rect = canvasEl.value!.getBoundingClientRect()
  pending.value = { from: fromId, x: ev.clientX - rect.left, y: ev.clientY - rect.top }
  function onMove(e: PointerEvent) {
    if (!pending.value) return
    pending.value.x = e.clientX - rect.left
    pending.value.y = e.clientY - rect.top
  }
  function onUp(e: PointerEvent) {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const toId = el?.closest('[data-dest-jack]')?.getAttribute('data-dest-jack')
    if (toId && pending.value) addSlot(pending.value.from, toId)
    pending.value = null
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function addSlot(source: string, destination: string) {
  const slots = props.preset.modMatrix!
  if (slots.length >= 20) return
  slots.push({ source, destination, amountPct: 0, flag: 0, midiCC: null })
  selectedIndex.value = slots.length - 1
}
function removeSlot(i: number) {
  props.preset.modMatrix!.splice(i, 1)
  if (selectedIndex.value === i) selectedIndex.value = null
}
function selectSlot(i: number) {
  selectedIndex.value = selectedIndex.value === i ? null : i
}
function onCcInput(slot: ModMatrixSlot, raw: string) {
  if (raw === '') { slot.midiCC = null; return }
  const n = Math.min(127, Math.max(0, Math.round(Number(raw))))
  slot.midiCC = Number.isNaN(n) ? null : n
}

const selectedSlot = computed(() => (selectedIndex.value != null ? props.preset.modMatrix![selectedIndex.value] : null))
function sourceLabel(source: string): string {
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source]
  return customSourceFor(source)?.name ?? source
}
function customSourceFor(id: string): CustomMidiSource | undefined {
  return (props.preset.customMidiSources ?? []).find((s) => `custom:${s.id}` === id)
}

const cabledSlots = computed(() => {
  const nodes = props.preset.modulationNodes
  if (!nodes) return []
  const list: Array<{ index: number; x1: number; y1: number; x2: number; y2: number }> = []
  for (const [i, slot] of (props.preset.modMatrix ?? []).entries()) {
    if (!nodes.sources.includes(slot.source) || !nodes.destinations.includes(slot.destination)) continue
    const from = sourceDotPos(slot.source)
    const to = destDotPos(slot.destination)
    list.push({ index: i, x1: from.x, y1: from.y, x2: to.x, y2: to.y })
  }
  return list
})

// -- Node CRUD -----------------------------------------------------------
function addSourceNode(type: string) {
  if (!type) return
  if (type === CUSTOM_SOURCE_OPTION) { addCustomSource(); return }
  const nodes = props.preset.modulationNodes!
  if (nodes.sources.includes(type)) return
  props.preset.modulationLayout![type] ??= nextDefaultPos(nodes.sources.length, SOURCE_X)
  nodes.sources.push(type)
}
function addDestinationNode(type: string) {
  if (!type) return
  const nodes = props.preset.modulationNodes!
  if (nodes.destinations.includes(type)) return
  props.preset.modulationLayout![type] ??= nextDefaultPos(nodes.destinations.length, DEST_X)
  nodes.destinations.push(type)
}
function removeSourceNode(id: string) {
  const nodes = props.preset.modulationNodes!
  const i = nodes.sources.indexOf(id)
  if (i >= 0) nodes.sources.splice(i, 1)
  const slots = props.preset.modMatrix!
  for (let j = slots.length - 1; j >= 0; j--) if (slots[j].source === id) slots.splice(j, 1)
  selectedIndex.value = null
  if (id.startsWith('custom:')) {
    const sources = props.preset.customMidiSources
    const srcId = id.slice('custom:'.length)
    const si = sources?.findIndex((s) => s.id === srcId) ?? -1
    if (si >= 0) sources!.splice(si, 1)
  }
}
function removeDestinationNode(id: string) {
  const nodes = props.preset.modulationNodes!
  const i = nodes.destinations.indexOf(id)
  if (i >= 0) nodes.destinations.splice(i, 1)
  const slots = props.preset.modMatrix!
  for (let j = slots.length - 1; j >= 0; j--) if (slots[j].destination === id) slots.splice(j, 1)
  selectedIndex.value = null
}

// -- Custom MIDI sources ("Create MIDI Sources", naming and CC) ---------
function addCustomSource() {
  const sources = (props.preset.customMidiSources ??= [])
  const source: CustomMidiSource = { id: newId('midisrc'), name: `CC ${sources.length + 1}`, cc: 1 }
  sources.push(source)
  const nodeId = `custom:${source.id}`
  const nodes = props.preset.modulationNodes!
  props.preset.modulationLayout![nodeId] = nextDefaultPos(nodes.sources.length, SOURCE_X)
  nodes.sources.push(nodeId)
}
function onCustomNameInput(id: string, name: string) {
  const src = customSourceFor(id)
  if (src) src.name = name
}
function onCustomCcInput(id: string, raw: string) {
  const src = customSourceFor(id)
  if (!src) return
  const n = Math.min(127, Math.max(0, Math.round(Number(raw))))
  src.cc = Number.isNaN(n) ? 0 : n
}

// -- Modulation preset library -----------------------------------------
const library = useFxModLibrary()
const modPresets = computed(() => library.records.value.filter((r) => r.kind === 'modulation'))
const selectedPresetId = ref('')

onMounted(() => { void library.refresh() })

/** Custom MIDI sources actually referenced by the current mod matrix --
 * what a saved patch needs to carry so its cables resolve when recalled. */
function usedCustomSources(): CustomMidiSource[] {
  const ids = new Set(
    (props.preset.modMatrix ?? [])
      .filter((s) => s.source.startsWith('custom:'))
      .map((s) => s.source.slice('custom:'.length)),
  )
  return (props.preset.customMidiSources ?? []).filter((s) => ids.has(s.id))
}
async function saveAsPreset() {
  const name = prompt('Save modulation patch as...')
  if (!name) return
  await library.saveModulation(name, { slots: props.preset.modMatrix!, lfo1: props.preset.lfo1!, lfo2: props.preset.lfo2!, customMidiSources: usedCustomSources() })
}
/** Overwrites the currently selected/recalled patch with the canvas's
 * current routing -- "Save as…" always makes a new record, so this is the
 * only way to persist edits back onto a patch after `applyPreset` recalls it. */
async function saveOverPreset() {
  if (!selectedPresetId.value) return
  await library.updateModulation(selectedPresetId.value, { slots: props.preset.modMatrix!, lfo1: props.preset.lfo1!, lfo2: props.preset.lfo2!, customMidiSources: usedCustomSources() })
}
function applyPreset() {
  const record = modPresets.value.find((r) => r.id === selectedPresetId.value)
  if (!record || record.kind !== 'modulation') return
  const cloned = deepClonePlain(record.data)

  // Custom MIDI sources referenced by the recalled slots aren't part of
  // this preset yet -- reconstruct them under fresh ids (so they never
  // collide with any custom source this preset already has) and remap the
  // slots' `custom:<id>` source strings to match.
  const idMap = new Map<string, string>()
  for (const old of cloned.customMidiSources ?? []) {
    const fresh: CustomMidiSource = { ...old, id: newId('midisrc') }
    idMap.set(old.id, fresh.id)
    ;(props.preset.customMidiSources ??= []).push(fresh)
  }
  for (const slot of cloned.slots) {
    if (!slot.source.startsWith('custom:')) continue
    const freshId = idMap.get(slot.source.slice('custom:'.length))
    if (freshId) slot.source = `custom:${freshId}`
  }

  props.preset.modMatrix!.splice(0, props.preset.modMatrix!.length, ...cloned.slots)
  props.preset.lfo1 = cloned.lfo1
  props.preset.lfo2 = cloned.lfo2

  // The canvas only shows nodes the user has placed (opt-in, see the
  // watch() above) -- a recalled patch's cables need their source/
  // destination nodes seeded onto the canvas or they'd have nowhere to
  // render (cabledSlots below filters cables to placed nodes only).
  const nodes = props.preset.modulationNodes!
  for (const slot of cloned.slots) {
    if (!nodes.sources.includes(slot.source)) {
      props.preset.modulationLayout![slot.source] ??= nextDefaultPos(nodes.sources.length, SOURCE_X)
      nodes.sources.push(slot.source)
    }
    if (!nodes.destinations.includes(slot.destination)) {
      props.preset.modulationLayout![slot.destination] ??= nextDefaultPos(nodes.destinations.length, DEST_X)
      nodes.destinations.push(slot.destination)
    }
  }

  selectedIndex.value = null
}
async function deletePreset() {
  if (!selectedPresetId.value) return
  await library.remove(selectedPresetId.value)
  selectedPresetId.value = ''
}
</script>

<template>
  <PatchCanvasFrame v-slot="{ fullscreen, toggle }">
    <div class="flex flex-col gap-2" :style="fullscreen ? { flex: '1', minHeight: '0' } : {}">
    <div class="flex flex-wrap items-center gap-2">
      <select class="sd-input text-xs" @change="addSourceNode(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
        <option value="" disabled selected>Add source…</option>
        <option :value="CUSTOM_SOURCE_OPTION">Custom MIDI Source…</option>
        <option v-for="id in availableSourceTypes" :key="id" :value="id">{{ SOURCE_LABELS[id] }}</option>
      </select>
      <select class="sd-input text-xs" :disabled="!availableDestTypes.length" @change="addDestinationNode(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
        <option value="" disabled selected>{{ availableDestTypes.length ? 'Add destination…' : 'All destinations placed' }}</option>
        <option v-for="id in availableDestTypes" :key="id" :value="id">{{ DEST_LABELS[id] }}</option>
      </select>
      <span class="text-xs" style="color: var(--color-ink-soft)">{{ preset.modMatrix?.length ?? 0 }}/20 routings</span>
      <div class="flex-1"></div>
      <select v-model="selectedPresetId" class="sd-input text-xs">
        <option value="">Load saved patch…</option>
        <option v-for="r in modPresets" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
      <button class="sd-btn sd-btn-icon" title="Apply selected patch" :disabled="!selectedPresetId" @click="applyPreset"><FolderOpen :size="14" /></button>
      <button class="sd-btn sd-btn-icon sd-btn-danger" title="Delete selected saved patch" :disabled="!selectedPresetId" @click="deletePreset"><X :size="14" /></button>
      <button class="sd-btn sd-btn-icon" title="Save over the selected patch" :disabled="!selectedPresetId" @click="saveOverPreset"><Save :size="14" /></button>
      <button class="sd-btn inline-flex items-center gap-1" title="Save this patch to the library" @click="saveAsPreset"><Save :size="14" /> Save as…</button>
      <button class="sd-btn sd-btn-icon" :title="fullscreen ? 'Exit full screen (Esc)' : 'Full screen'" @click="toggle">
        <Minimize2 v-if="fullscreen" :size="14" />
        <Maximize2 v-else :size="14" />
      </button>
    </div>

    <div
      v-if="preset.modMatrix && preset.lfo1 && preset.lfo2 && preset.modulationLayout && preset.modulationNodes" ref="canvasEl" class="relative sd-scroll rounded-lg border"
      :style="{
        borderColor: 'var(--color-mocha)', backgroundColor: 'var(--color-cream)',
        overflow: 'auto', minHeight: '200px',
        height: fullscreen ? 'auto' : '340px',
        flex: fullscreen ? '1' : 'initial',
        resize: fullscreen ? 'none' : 'vertical',
      }"
    >
      <div class="relative" :style="{ width: '620px', height: canvasHeight + 'px' }">
        <svg class="absolute inset-0" style="pointer-events: none; z-index: 5" width="620" :height="canvasHeight">
          <PatchCable
            v-for="c in cabledSlots" :key="c.index"
            :x1="c.x1" :y1="c.y1" :x2="c.x2" :y2="c.y2"
            :active="selectedIndex === c.index"
            @click="selectSlot(c.index)"
          />
          <PatchCable v-if="pending" :x1="sourceDotPos(pending.from).x" :y1="sourceDotPos(pending.from).y" :x2="pending.x" :y2="pending.y" active />
        </svg>

        <div v-if="!preset.modulationNodes.sources.length && !preset.modulationNodes.destinations.length" class="absolute text-xs" :style="{ left: SOURCE_X + 'px', top: '8px', color: 'var(--color-ink-soft)' }">
          Add a source and a destination to start patching.
        </div>

        <!-- Sources -->
        <template v-for="id in preset.modulationNodes.sources" :key="id">
          <template v-if="id === 'patchLfo1' || id === 'patchLfo2'">
            <div class="absolute cursor-move" :style="{ left: panelPos(id).x + 'px', top: panelPos(id).y + 'px', zIndex: 10 }" @pointerdown="startPositionDrag(id, $event)">
              <LfoEditor :lfo="id === 'patchLfo1' ? preset.lfo1 : preset.lfo2" :title="SOURCE_LABELS[id]" show-sync patch-mode @remove="removeSourceNode(id)" />
            </div>
            <button class="absolute rounded-full" :style="{ left: sourceDotPos(id).x + 'px', top: sourceDotPos(id).y + 'px', width: '12px', height: '12px', background: 'var(--color-primary-dark)', border: 'none', cursor: 'pointer', zIndex: 11 }" title="Drag to a destination" :data-src-jack="id" @pointerdown="startCable(id, $event)" />
          </template>

          <div
            v-else-if="id.startsWith('custom:')"
            class="absolute sd-node-mod flex items-center gap-2 px-2 py-1 cursor-move"
            :style="{ left: panelPos(id).x + 'px', top: panelPos(id).y + 'px', width: '224px', zIndex: 10 }"
            @pointerdown="startPositionDrag(id, $event)"
          >
            <input class="sd-input text-xs flex-1 min-w-0" :value="customSourceFor(id)?.name" @input="onCustomNameInput(id, ($event.target as HTMLInputElement).value)" placeholder="Source name" />
            <label class="flex items-center gap-1 text-xs shrink-0">
              CC
              <input type="number" min="0" max="127" class="sd-input text-xs w-12" :value="customSourceFor(id)?.cc" @input="onCustomCcInput(id, ($event.target as HTMLInputElement).value)" />
            </label>
            <button class="sd-btn sd-btn-icon sd-btn-danger shrink-0" title="Remove source" @click="removeSourceNode(id)"><X :size="12" /></button>
            <button
              class="rounded-full shrink-0"
              style="width: 12px; height: 12px; background: var(--color-primary-dark); border: none; cursor: pointer"
              title="Drag to a destination"
              @pointerdown.stop="startCable(id, $event)"
            />
          </div>

          <div
            v-else
            class="absolute sd-node-mod flex items-center justify-between gap-2 px-2 py-1 cursor-move"
            :style="{ left: panelPos(id).x + 'px', top: panelPos(id).y + 'px', width: '224px', zIndex: 10 }"
            @pointerdown="startPositionDrag(id, $event)"
          >
            <span class="text-xs">{{ SOURCE_LABELS[id] }}</span>
            <button class="sd-btn sd-btn-icon sd-btn-danger" style="width: 16px; height: 16px" title="Remove source" @click.stop="removeSourceNode(id)"><X :size="10" /></button>
            <button
              class="rounded-full shrink-0"
              style="width: 12px; height: 12px; background: var(--color-primary-dark); border: none; cursor: pointer"
              title="Drag to a destination"
              @pointerdown.stop="startCable(id, $event)"
            />
          </div>
        </template>

        <!-- Destinations -->
        <div
          v-for="id in preset.modulationNodes.destinations" :key="id"
          class="absolute sd-node-mod flex items-center gap-2 px-2 py-1 cursor-move"
          :style="{ left: panelPos(id).x + 'px', top: panelPos(id).y + 'px', width: '190px', zIndex: 10 }"
          @pointerdown="startPositionDrag(id, $event)"
        >
          <button
            class="rounded-full shrink-0"
            style="width: 12px; height: 12px; background: var(--color-mocha); border: none; cursor: pointer"
            title="Cable a source here"
            :data-dest-jack="id"
            @pointerdown.stop
          />
          <span class="text-xs flex-1">{{ DEST_LABELS[id] ?? id }}</span>
          <button class="sd-btn sd-btn-icon sd-btn-danger" style="width: 16px; height: 16px" title="Remove destination" @click.stop="removeDestinationNode(id)"><X :size="10" /></button>
        </div>
      </div>
    </div>

    <div v-if="selectedSlot" class="sd-panel flex items-center gap-3 flex-wrap">
      <span class="text-xs font-bold">{{ sourceLabel(selectedSlot.source) }} &rarr; {{ DEST_LABELS[selectedSlot.destination] ?? selectedSlot.destination }}</span>
      <Dial v-model="selectedSlot.amountPct" :min="-100" :max="100" :size="36" :format-value="fmtPct" :learn-id="`sd:mod:patch:slot:${selectedIndex}`" />
      <label class="flex items-center gap-1 text-xs" title="Custom MIDI CC -- overrides the Source jack when set">
        CC
        <input
          type="number" min="0" max="127"
          :value="selectedSlot.midiCC ?? ''"
          placeholder="&mdash;"
          class="sd-input text-xs w-14"
          @input="onCcInput(selectedSlot, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <button class="sd-btn sd-btn-icon sd-btn-danger" title="Remove routing" @click="removeSlot(selectedIndex!)"><X :size="14" /></button>
    </div>
    </div>
  </PatchCanvasFrame>
</template>
