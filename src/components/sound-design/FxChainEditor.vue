<script setup lang="ts">
// Free-form FX patch canvas: drag effect nodes onto the canvas, cable them
// Input -> node(s) -> Output (parallel branches allowed -- multiple cables
// out of one jack fan out, multiple into one jack sum). Shared by Preset FX
// (Performance's Center Pane, Sound Design's FX tab) and Global FX (TopBar
// popover) -- same `FxChain` shape either way. See
// docs/plans/FX-Modulations.md's "FX Chain patching" for the full design;
// EffectChain (core/audio/effects.ts) is the audio-engine side of this.
import { ref, computed, watch, onMounted } from 'vue'
import {
  EFFECT_ALGORITHMS, EFFECT_PARAM_SCHEMAS, blankFxNode, hasCycle,
  DEFAULT_INPUT_POSITION, DEFAULT_OUTPUT_POSITION, type EffectAlgorithm,
} from '../../core/audio/effects'
import type { FxChain } from '../../core/audio/types'
import { newId } from '../../utils/id'
import { deepClonePlain } from '../../utils/deepClone'
import { useFxModLibrary } from '../../composables/useFxModLibrary'
import Dial from './Dial.vue'
import PatchCable from './PatchCable.vue'
import PatchCanvasFrame from './PatchCanvasFrame.vue'
import { X, Save, FolderOpen, Maximize2, Minimize2, ChevronRight, ChevronDown, Power } from '@lucide/vue'

const props = defineProps<{ chain: FxChain; learnScope: string }>()

const ALGORITHM_LABELS: Record<EffectAlgorithm, string> = {
  reverb: 'Reverb', delay: 'Delay', chorus: 'Chorus', eq4: '4-Band EQ', compressor: 'Compressor', phaser: 'Phaser',
}

const NODE_WIDTH = 180
const JACK_Y = 22

const canvasEl = ref<HTMLElement | null>(null)
const fmtPct = (v: number) => `${Math.round(v)}%`
const fmtDb = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`

// FX Input/Output are pseudo-nodes too -- optional/lazily-seeded fields on
// FxChain (a chain saved before they existed won't have them at runtime),
// same pattern as `preset.fx ??= blankFxChain()` elsewhere. Re-runs
// whenever `chain` itself changes (e.g. Performance mode switching to a
// different preset re-uses this same component instance with a new prop).
watch(() => props.chain, (chain) => {
  chain.inputGainDb ??= 0
  chain.inputPosition ??= { ...DEFAULT_INPUT_POSITION }
  chain.outputPosition ??= { ...DEFAULT_OUTPUT_POSITION }
}, { immediate: true })

const canvasWidth = computed(() => {
  const outX = props.chain.outputPosition?.x ?? DEFAULT_OUTPUT_POSITION.x
  return Math.max(outX + 220, ...props.chain.nodes.map((n) => n.position.x + NODE_WIDTH + 200))
})
const canvasHeight = computed(() => {
  const inY = props.chain.inputPosition?.y ?? DEFAULT_INPUT_POSITION.y
  const outY = props.chain.outputPosition?.y ?? DEFAULT_OUTPUT_POSITION.y
  return Math.max(320, inY + 220, outY + 220, ...props.chain.nodes.map((n) => n.position.y + 260))
})

function outJack(id: string): { x: number; y: number } {
  if (id === 'input') {
    const pos = props.chain.inputPosition ?? DEFAULT_INPUT_POSITION
    return { x: pos.x + 64, y: pos.y + JACK_Y }
  }
  const node = props.chain.nodes.find((n) => n.id === id)
  return node ? { x: node.position.x + NODE_WIDTH, y: node.position.y + JACK_Y } : { x: 0, y: 0 }
}
function inJack(id: string): { x: number; y: number } {
  if (id === 'output') {
    const pos = props.chain.outputPosition ?? DEFAULT_OUTPUT_POSITION
    return { x: pos.x, y: pos.y + JACK_Y }
  }
  const node = props.chain.nodes.find((n) => n.id === id)
  return node ? { x: node.position.x, y: node.position.y + JACK_Y } : { x: 0, y: 0 }
}

// Light/dark cable coloring: a cable straight off the Input jack reads
// light, one landing on the Output jack reads dark -- a cable between two
// ordinary nodes keeps PatchCable's own neutral default.
const EDGE_COLOR_INPUT = 'var(--color-skyblue)'
const EDGE_COLOR_OUTPUT = 'var(--color-ink)'
function edgeColor(edge: { from: string; to: string }): string | undefined {
  if (edge.to === 'output') return EDGE_COLOR_OUTPUT
  if (edge.from === 'input') return EDGE_COLOR_INPUT
  return undefined
}

// -- Node/pseudo-node drag ------------------------------------------------
// Shared by FX nodes (`node.position`) and the Input/Output pseudo-nodes
// (`chain.inputPosition`/`outputPosition`) -- same drag mechanics either way.
function startPositionDrag(position: { x: number; y: number }, ev: PointerEvent) {
  if ((ev.target as HTMLElement).closest('.sd-dial-wrap, button, select, input')) return
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

// -- Cable drag ---------------------------------------------------------
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
    const toId = el?.closest('[data-in-jack]')?.getAttribute('data-in-jack')
    if (toId && pending.value) addEdge(pending.value.from, toId)
    pending.value = null
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function addEdge(from: string, to: string) {
  if (from === to) return
  if (props.chain.edges.some((e) => e.from === from && e.to === to)) return
  const candidate = { id: newId('fxedge'), from, to }
  // Reject at creation time, not just at EffectChain.rebuild() -- a cycle
  // silently falling back to dry passthrough later would be a confusing,
  // invisible failure. See docs/plans/FX-Modulations.md's "Constraints".
  if (hasCycle(props.chain.nodes, [...props.chain.edges, candidate])) {
    console.warn('[FxChainEditor] rejected cable -- would create a cycle')
    return
  }
  props.chain.edges.push(candidate)
}
function removeEdge(id: string) {
  const i = props.chain.edges.findIndex((e) => e.id === id)
  if (i >= 0) props.chain.edges.splice(i, 1)
}

// -- Node CRUD ------------------------------------------------------------
const MAX_NODES = 12
const canAdd = computed(() => props.chain.nodes.length < MAX_NODES)

function addNode(algorithm: EffectAlgorithm) {
  if (!canAdd.value) return
  const outX = props.chain.outputPosition?.x ?? DEFAULT_OUTPUT_POSITION.x
  const x = props.chain.nodes.length ? Math.max(...props.chain.nodes.map((n) => n.position.x)) + 220 : 220
  props.chain.nodes.push(blankFxNode(algorithm, { x: Math.min(x, outX - 220), y: 80 + (props.chain.nodes.length % 3) * 90 }))
}
function removeNode(id: string) {
  const i = props.chain.nodes.findIndex((n) => n.id === id)
  if (i >= 0) props.chain.nodes.splice(i, 1)
  for (let j = props.chain.edges.length - 1; j >= 0; j--) {
    const e = props.chain.edges[j]
    if (e.from === id || e.to === id) props.chain.edges.splice(j, 1)
  }
  expandedNodes.value.delete(id)
}

// -- Collapse/expand -----------------------------------------------------
// Purely local display state, not part of FxNode/persisted chain data (like
// which tab is active elsewhere in the app) -- a node not yet in this set is
// collapsed, so every node starts collapsed by default, including ones
// already on the canvas when this component mounts (a freshly loaded/saved
// chain, or a saved-library chain just applied).
const expandedNodes = ref(new Set<string>())
function isExpanded(id: string): boolean {
  return expandedNodes.value.has(id)
}
function toggleExpanded(id: string) {
  if (expandedNodes.value.has(id)) expandedNodes.value.delete(id)
  else expandedNodes.value.add(id)
}

// -- FX preset library ------------------------------------------------
const library = useFxModLibrary()
const fxPresets = computed(() => library.records.value.filter((r) => r.kind === 'fx'))
const selectedPresetId = ref('')

onMounted(() => { void library.refresh() })

async function saveAsPreset() {
  const name = prompt('Save FX chain as...')
  if (!name) return
  await library.saveFx(name, {
    nodes: props.chain.nodes, edges: props.chain.edges, wetDry: props.chain.wetDry,
    inputGainDb: props.chain.inputGainDb ?? 0,
    inputPosition: props.chain.inputPosition ?? DEFAULT_INPUT_POSITION,
    outputPosition: props.chain.outputPosition ?? DEFAULT_OUTPUT_POSITION,
  })
}
function applyPreset() {
  const record = fxPresets.value.find((r) => r.id === selectedPresetId.value)
  if (!record || record.kind !== 'fx') return
  const cloned = deepClonePlain(record.data)
  props.chain.nodes.splice(0, props.chain.nodes.length, ...cloned.nodes)
  props.chain.edges.splice(0, props.chain.edges.length, ...cloned.edges)
  props.chain.wetDry = cloned.wetDry
  props.chain.inputGainDb = cloned.inputGainDb ?? 0
  props.chain.inputPosition = cloned.inputPosition ?? { ...DEFAULT_INPUT_POSITION }
  props.chain.outputPosition = cloned.outputPosition ?? { ...DEFAULT_OUTPUT_POSITION }
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
        <select class="sd-input text-xs" :disabled="!canAdd" @change="addNode(($event.target as HTMLSelectElement).value as EffectAlgorithm); ($event.target as HTMLSelectElement).value = ''">
          <option value="" disabled selected>{{ canAdd ? 'Add node…' : `Max ${MAX_NODES} nodes` }}</option>
          <option v-for="a in EFFECT_ALGORITHMS" :key="a" :value="a">{{ ALGORITHM_LABELS[a] }}</option>
        </select>

        <div class="flex-1"></div>

        <select v-model="selectedPresetId" class="sd-input text-xs">
          <option value="">Load saved chain…</option>
          <option v-for="r in fxPresets" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
        <button class="sd-btn sd-btn-icon" title="Apply selected chain" :disabled="!selectedPresetId" @click="applyPreset"><FolderOpen :size="14" /></button>
        <button class="sd-btn sd-btn-icon sd-btn-danger" title="Delete selected saved chain" :disabled="!selectedPresetId" @click="deletePreset"><X :size="14" /></button>
        <button class="sd-btn inline-flex items-center gap-1" title="Save this chain to the library" @click="saveAsPreset"><Save :size="14" /> Save as…</button>
        <button class="sd-btn sd-btn-icon" :title="fullscreen ? 'Exit full screen (Esc)' : 'Full screen'" @click="toggle">
          <Minimize2 v-if="fullscreen" :size="14" />
          <Maximize2 v-else :size="14" />
        </button>
      </div>

      <div
        ref="canvasEl" class="relative sd-scroll rounded-lg border"
        :style="{
          borderColor: 'var(--color-mocha)', backgroundColor: 'var(--color-cream)',
          overflow: 'auto', minHeight: '200px',
          height: fullscreen ? 'auto' : '340px',
          flex: fullscreen ? '1' : 'initial',
          resize: fullscreen ? 'none' : 'vertical',
        }"
      >
        <div class="relative" :style="{ width: canvasWidth + 'px', height: canvasHeight + 'px' }">
        <svg class="absolute inset-0" style="pointer-events: none; z-index: 5" :width="canvasWidth" :height="canvasHeight">
          <PatchCable
            v-for="edge in chain.edges" :key="edge.id"
            :x1="outJack(edge.from).x" :y1="outJack(edge.from).y"
            :x2="inJack(edge.to).x" :y2="inJack(edge.to).y"
            :color="edgeColor(edge)"
            @click="removeEdge(edge.id)"
          />
          <PatchCable v-if="pending" :x1="outJack(pending.from).x" :y1="outJack(pending.from).y" :x2="pending.x" :y2="pending.y" active />
        </svg>

        <!-- Input pseudo-node -->
        <div
          class="absolute sd-panel flex flex-col items-center gap-1 px-3 py-2"
          style="cursor: grab; z-index: 10"
          :style="{ left: (chain.inputPosition ?? DEFAULT_INPUT_POSITION).x + 'px', top: (chain.inputPosition ?? DEFAULT_INPUT_POSITION).y + 'px' }"
          @pointerdown="startPositionDrag(chain.inputPosition!, $event)"
        >
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold">Input</span>
            <button
              class="rounded-full"
              style="width: 12px; height: 12px; background: var(--color-skyblue); border: none; cursor: pointer"
              title="Drag to a node's input, or straight to Output"
              data-out-jack="input"
              @pointerdown="startCable('input', $event)"
            />
          </div>
          <Dial
            v-model="chain.inputGainDb" :min="-60" :max="0" :step="0.5"
            label="Gain" :size="32" :format-value="fmtDb"
            :learn-id="`sd:fx:${learnScope}:inputgain`"
          />
        </div>

        <!-- Output pseudo-node -->
        <div
          class="absolute sd-panel flex flex-col items-center gap-1 px-3 py-2"
          style="cursor: grab; z-index: 10"
          :style="{ left: (chain.outputPosition ?? DEFAULT_OUTPUT_POSITION).x + 'px', top: (chain.outputPosition ?? DEFAULT_OUTPUT_POSITION).y + 'px' }"
          @pointerdown="startPositionDrag(chain.outputPosition!, $event)"
        >
          <div class="flex items-center gap-2">
            <button
              class="rounded-full"
              style="width: 12px; height: 12px; background: var(--color-ink); border: none; cursor: pointer"
              title="Cable a node's output here"
              data-in-jack="output"
            />
            <span class="text-xs font-bold">Output</span>
          </div>
          <Dial
            v-model="chain.wetDry" :min="0" :max="100" :step="1"
            label="FX Mix" :size="32" :format-value="fmtPct"
            :learn-id="`sd:fx:${learnScope}:wetdry`"
          />
        </div>

        <!-- FX nodes -->
        <div
          v-for="node in chain.nodes" :key="node.id"
          class="absolute sd-node flex flex-col gap-2"
          :class="node.bypass ? 'opacity-50' : ''"
          style="width: 180px; cursor: grab; z-index: 10"
          :style="{ left: node.position.x + 'px', top: node.position.y + 'px' }"
          @pointerdown="startPositionDrag(node.position, $event)"
        >
          <button
            class="absolute rounded-full"
            style="left: -6px; top: 16px; width: 12px; height: 12px; background: var(--color-mocha); border: none; cursor: pointer"
            title="Cable input"
            :data-in-jack="node.id"
          />
          <button
            class="absolute rounded-full"
            style="right: -6px; top: 16px; width: 12px; height: 12px; background: var(--color-primary-dark); border: none; cursor: pointer"
            title="Drag to another node's input, or Output"
            :data-out-jack="node.id"
            @pointerdown="startCable(node.id, $event)"
          />

          <div class="flex items-center justify-between gap-1">
            <button class="sd-btn sd-btn-icon" style="width: 20px; height: 20px" :title="isExpanded(node.id) ? 'Collapse' : 'Expand controls'" @click="toggleExpanded(node.id)">
              <ChevronDown v-if="isExpanded(node.id)" :size="12" />
              <ChevronRight v-else :size="12" />
            </button>
            <span class="text-xs font-bold truncate flex-1">{{ ALGORITHM_LABELS[node.algorithm] }}</span>
            <button
              class="sd-btn sd-btn-icon" style="width: 20px; height: 20px"
              :class="node.bypass ? '' : 'sd-btn-primary'"
              :title="node.bypass ? 'Bypassed -- click to re-enable' : 'Click to bypass'"
              @click="node.bypass = !node.bypass"
            >
              <Power :size="12" />
            </button>
            <button class="sd-btn sd-btn-icon sd-btn-danger" style="width: 20px; height: 20px" title="Remove node" @click="removeNode(node.id)"><X :size="12" /></button>
          </div>

          <div v-if="isExpanded(node.id)" class="flex flex-wrap gap-2 pt-4 pb-2 justify-center bg-mocha-20 rounded-lg">
            <Dial
              v-for="schema in EFFECT_PARAM_SCHEMAS[node.algorithm]" :key="schema.key"
              v-model="node.params[schema.key]"
              :min="schema.min" :max="schema.max" :step="schema.step"
              :label="schema.label" :size="32"
              :learn-id="`sd:fx:${learnScope}:${node.id}:${schema.key}`"
              :format-value="schema.formatValue"
            />
            <Dial v-model="node.wetDry" :min="0" :max="100" :step="1" label="Mix" :size="32" :format-value="fmtPct" :learn-id="`sd:fx:${learnScope}:${node.id}:wetdry`" />
          </div>

          <!-- <div v-if="isExpanded(node.id)" class="flex justify-center">
          </div> -->
        </div>
      </div>
    </div>
    </div>
  </PatchCanvasFrame>
</template>
