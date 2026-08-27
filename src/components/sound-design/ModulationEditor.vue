<script setup lang="ts">
// Patch-level Modulation panel: a fixed source/destination jack panel (not
// a free-form graph like FxChainEditor -- sources and destinations are a
// known, non-creatable catalog, only the cables between them are user
// content). A cable = one ModMatrixSlot on `preset.modMatrix`, applied to
// every layer's voices on top of that layer's own routings -- see
// docs/plans/FX-Modulations.md's "Modulation patching" (Decision 1,
// Option B) and core/audio/modMatrix.ts.
import { ref, computed, watch, onMounted } from 'vue'
import { KNOWN_MOD_DESTINATIONS } from '../../data/modMatrixEnums'
import { blankLfo } from '../../core/soundDesign/defaults'
import { useFxModLibrary } from '../../composables/useFxModLibrary'
import { deepClonePlain } from '../../utils/deepClone'
import type { Preset, ModMatrixSlot } from '../../core/audio/types'
import Dial from './Dial.vue'
import LfoEditor from './LfoEditor.vue'
import PatchCable from './PatchCable.vue'
import PatchCanvasFrame from './PatchCanvasFrame.vue'
import { X, Save, FolderOpen, Maximize2, Minimize2 } from '@lucide/vue'

const props = defineProps<{ preset: Preset }>()

watch(() => props.preset, (preset) => {
  preset.modMatrix ??= []
  preset.lfo1 ??= blankLfo()
  preset.lfo2 ??= blankLfo()
}, { immediate: true })

const DEST_LABELS: Record<string, string> = {
  pitch: 'Pitch', filterFreq: 'Filter Freq', filterQ: 'Filter Q', volEnvDecay: 'Vol Env Decay',
  lfo1Rate: 'LFO1 Rate', lfo2Rate: 'LFO2 Rate', velocityDefault: 'Velocity Default', wetDryMix: 'FX Wet/Dry',
}
const SOURCE_LABELS: Record<string, string> = {
  pitchWheel: 'Pitch Wheel', key: 'Key', gate: 'Gate', pressure: 'Pressure', velocity: 'Velocity',
}
const PLAIN_SOURCES = ['pitchWheel', 'key', 'gate', 'pressure', 'velocity']

const SOURCE_X = 8
const SOURCE_JACK_X = 232
const DEST_X = 420
const LFO_ROW_HEIGHT = 216
const JACK_ROW_HEIGHT = 44
const DEST_ROW_HEIGHT = 44

const lfoRowY = (i: number) => 8 + i * LFO_ROW_HEIGHT
const plainSourceY = (i: number) => 8 + 2 * LFO_ROW_HEIGHT + i * JACK_ROW_HEIGHT
const destY = (i: number) => 8 + i * DEST_ROW_HEIGHT

const sourceJackPos: Record<string, { x: number; y: number }> = {
  patchLfo1: { x: SOURCE_JACK_X, y: lfoRowY(0) + 20 },
  patchLfo2: { x: SOURCE_JACK_X, y: lfoRowY(1) + 20 },
}
PLAIN_SOURCES.forEach((id, i) => { sourceJackPos[id] = { x: SOURCE_JACK_X, y: plainSourceY(i) + 20 } })

const destJackPos = computed(() => {
  const pos: Record<string, { x: number; y: number }> = {}
  KNOWN_MOD_DESTINATIONS.forEach((id, i) => { pos[id] = { x: DEST_X, y: destY(i) + 20 } })
  return pos
})

const canvasHeight = plainSourceY(PLAIN_SOURCES.length) + 40

const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}%`
const canvasEl = ref<HTMLElement | null>(null)
const selectedIndex = ref<number | null>(null)

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

// Vue 3's v-if takes precedence over v-for on the same element, so a slot
// whose source/destination jack isn't in this fixed panel (e.g. authored
// via the per-layer Mod Matrix editor's fuller catalog) can't be filtered
// with v-if inline on the PatchCable -- precompute the drawable subset here
// instead.
const cabledSlots = computed(() => {
  const list: Array<{ index: number; x1: number; y1: number; x2: number; y2: number }> = []
  for (const [i, slot] of (props.preset.modMatrix ?? []).entries()) {
    const from = sourceJackPos[slot.source]
    const to = destJackPos.value[slot.destination]
    if (from && to) list.push({ index: i, x1: from.x, y1: from.y, x2: to.x, y2: to.y })
  }
  return list
})

// -- Modulation preset library -----------------------------------------
const library = useFxModLibrary()
const modPresets = computed(() => library.records.value.filter((r) => r.kind === 'modulation'))
const selectedPresetId = ref('')

onMounted(() => { void library.refresh() })

async function saveAsPreset() {
  const name = prompt('Save modulation patch as...')
  if (!name) return
  await library.saveModulation(name, { slots: props.preset.modMatrix!, lfo1: props.preset.lfo1!, lfo2: props.preset.lfo2! })
}
function applyPreset() {
  const record = modPresets.value.find((r) => r.id === selectedPresetId.value)
  if (!record || record.kind !== 'modulation') return
  const cloned = deepClonePlain(record.data)
  props.preset.modMatrix!.splice(0, props.preset.modMatrix!.length, ...cloned.slots)
  props.preset.lfo1 = cloned.lfo1
  props.preset.lfo2 = cloned.lfo2
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
      <span class="text-xs" style="color: var(--color-ink-soft)">{{ preset.modMatrix?.length ?? 0 }}/20 routings &mdash; drag a source jack to a destination jack</span>
      <div class="flex-1"></div>
      <select v-model="selectedPresetId" class="sd-input text-xs">
        <option value="">Load saved patch…</option>
        <option v-for="r in modPresets" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
      <button class="sd-btn sd-btn-icon" title="Apply selected patch" :disabled="!selectedPresetId" @click="applyPreset"><FolderOpen :size="14" /></button>
      <button class="sd-btn sd-btn-icon sd-btn-danger" title="Delete selected saved patch" :disabled="!selectedPresetId" @click="deletePreset"><X :size="14" /></button>
      <button class="sd-btn inline-flex items-center gap-1" title="Save this patch to the library" @click="saveAsPreset"><Save :size="14" /> Save as…</button>
      <button class="sd-btn sd-btn-icon" :title="fullscreen ? 'Exit full screen (Esc)' : 'Full screen'" @click="toggle">
        <Minimize2 v-if="fullscreen" :size="14" />
        <Maximize2 v-else :size="14" />
      </button>
    </div>

    <div
      v-if="preset.modMatrix && preset.lfo1 && preset.lfo2" ref="canvasEl" class="relative sd-scroll rounded-lg border"
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
          <PatchCable v-if="pending" :x1="sourceJackPos[pending.from]?.x ?? 0" :y1="sourceJackPos[pending.from]?.y ?? 0" :x2="pending.x" :y2="pending.y" active />
        </svg>

        <!-- Sources -->
        <div class="absolute" :style="{ left: SOURCE_X + 'px', top: lfoRowY(0) + 'px', zIndex: 10 }">
          <LfoEditor :lfo="preset.lfo1" title="LFO 1 (patch)" />
        </div>
        <button class="absolute rounded-full" :style="{ left: SOURCE_JACK_X + 'px', top: (lfoRowY(0) + 20) + 'px', width: '12px', height: '12px', background: 'var(--color-primary-dark)', border: 'none', cursor: 'pointer', zIndex: 11 }" title="Drag to a destination" data-src-jack="patchLfo1" @pointerdown="startCable('patchLfo1', $event)" />

        <div class="absolute" :style="{ left: SOURCE_X + 'px', top: lfoRowY(1) + 'px', zIndex: 10 }">
          <LfoEditor :lfo="preset.lfo2" title="LFO 2 (patch)" />
        </div>
        <button class="absolute rounded-full" :style="{ left: SOURCE_JACK_X + 'px', top: (lfoRowY(1) + 20) + 'px', width: '12px', height: '12px', background: 'var(--color-primary-dark)', border: 'none', cursor: 'pointer', zIndex: 11 }" title="Drag to a destination" data-src-jack="patchLfo2" @pointerdown="startCable('patchLfo2', $event)" />

        <div
          v-for="(id, i) in PLAIN_SOURCES" :key="id"
          class="absolute sd-panel flex items-center justify-between gap-2 px-2 py-1"
          :style="{ left: SOURCE_X + 'px', top: plainSourceY(i) + 'px', width: '224px', zIndex: 10 }"
        >
          <span class="text-xs">{{ SOURCE_LABELS[id] }}</span>
          <button
            class="rounded-full shrink-0"
            style="width: 12px; height: 12px; background: var(--color-primary-dark); border: none; cursor: pointer"
            title="Drag to a destination"
            @pointerdown="startCable(id, $event)"
          />
        </div>

        <!-- Destinations -->
        <div
          v-for="(id, i) in KNOWN_MOD_DESTINATIONS" :key="id"
          class="absolute sd-panel flex items-center gap-2 px-2 py-1"
          :style="{ left: DEST_X + 'px', top: destY(i) + 'px', width: '190px', zIndex: 10 }"
        >
          <button
            class="rounded-full shrink-0"
            style="width: 12px; height: 12px; background: var(--color-mocha); border: none; cursor: pointer"
            title="Cable a source here"
            :data-dest-jack="id"
          />
          <span class="text-xs">{{ DEST_LABELS[id] ?? id }}</span>
        </div>
      </div>
    </div>

    <div v-if="selectedSlot" class="sd-panel flex items-center gap-3 flex-wrap">
      <span class="text-xs font-bold">{{ SOURCE_LABELS[selectedSlot.source] ?? selectedSlot.source }} &rarr; {{ DEST_LABELS[selectedSlot.destination] ?? selectedSlot.destination }}</span>
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
