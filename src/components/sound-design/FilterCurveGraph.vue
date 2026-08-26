<script setup lang="ts">
// Draggable frequency-response graph for the filter's Cutoff/Resonance,
// same "shape by eye" idea as EnvelopeDesigner.vue's envelope graph --
// drag the single point to set cutoff (x, log-frequency) and resonance
// (y, 0-127) together; the curve behind it is a stylized response shape
// per filter type, purely visual feedback (filter playback is currently
// bypassed -- see docs/ARCHITECTURE.md). Mutates `filter`'s fields
// directly, same direct-prop-mutation pattern as EnvelopeDesigner.vue.
import { ref, computed } from 'vue'
import type { FilterParams } from '../../core/audio/types'

const props = defineProps<{ filter: FilterParams }>()

const GRAPH_W = 480
const GRAPH_H = 160
const PAD = 14

const MIN_HZ = 20
const MAX_HZ = 20000
const MIN_LOG = Math.log10(MIN_HZ)
const MAX_LOG = Math.log10(MAX_HZ)

const BASE_LEVEL = 14 // "attenuated" baseline
const PASS_LEVEL = 82 // "passed through" flat baseline

function freqToX(hz: number): number {
  const frac = Math.min(1, Math.max(0, (Math.log10(Math.max(MIN_HZ, hz)) - MIN_LOG) / (MAX_LOG - MIN_LOG)))
  return PAD + frac * (GRAPH_W - 2 * PAD)
}
function xToFreq(x: number): number {
  const frac = Math.min(1, Math.max(0, (x - PAD) / (GRAPH_W - 2 * PAD)))
  return Math.round(10 ** (MIN_LOG + frac * (MAX_LOG - MIN_LOG)))
}
function levelToY(level: number): number {
  const frac = Math.min(1, Math.max(0, level / 127))
  return PAD + (GRAPH_H - 2 * PAD) * (1 - frac)
}
function yToLevel(y: number): number {
  const frac = Math.min(1, Math.max(0, (y - PAD) / (GRAPH_H - 2 * PAD)))
  return Math.round((1 - frac) * 127)
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}
function stepBlend(x: number, cutoffX: number, width: number, leftLevel: number, rightLevel: number): number {
  return leftLevel + (rightLevel - leftLevel) * sigmoid((x - cutoffX) / width)
}
function gaussian(x: number, center: number, width: number): number {
  const d = (x - center) / width
  return Math.exp(-d * d)
}

function levelAt(x: number, type: string, cutoffX: number, resonance: number): number {
  const ROLLOFF_W = 34
  const bumpWidth = 90 - Math.min(72, (resonance / 127) * 72) // narrower peak/notch as resonance rises
  switch (type) {
    case 'lowpass': {
      const base = stepBlend(x, cutoffX, ROLLOFF_W, PASS_LEVEL, BASE_LEVEL)
      return Math.min(127, base + Math.max(0, resonance - PASS_LEVEL) * gaussian(x, cutoffX, bumpWidth))
    }
    case 'highpass': {
      const base = stepBlend(x, cutoffX, ROLLOFF_W, BASE_LEVEL, PASS_LEVEL)
      return Math.min(127, base + Math.max(0, resonance - PASS_LEVEL) * gaussian(x, cutoffX, bumpWidth))
    }
    case 'bandpass':
    case 'peaking':
      return Math.min(127, BASE_LEVEL + Math.max(0, resonance - BASE_LEVEL) * gaussian(x, cutoffX, bumpWidth))
    case 'notch':
      return PASS_LEVEL - (PASS_LEVEL - BASE_LEVEL) * (resonance / 127) * gaussian(x, cutoffX, bumpWidth)
    case 'lowshelf': {
      const shelfLevel = PASS_LEVEL + (resonance - PASS_LEVEL) * 0.6
      return stepBlend(x, cutoffX, ROLLOFF_W * 1.6, shelfLevel, PASS_LEVEL)
    }
    case 'highshelf': {
      const shelfLevel = PASS_LEVEL + (resonance - PASS_LEVEL) * 0.6
      return stepBlend(x, cutoffX, ROLLOFF_W * 1.6, PASS_LEVEL, shelfLevel)
    }
    case 'allpass':
    default:
      return PASS_LEVEL
  }
}

const SAMPLES = 96
const cutoffX = computed(() => freqToX(props.filter.cutoffHzEstimated))
const handleY = computed(() => levelToY(props.filter.resonance))

const points = computed(() => {
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= SAMPLES; i++) {
    const x = PAD + (i / SAMPLES) * (GRAPH_W - 2 * PAD)
    const level = levelAt(x, props.filter.typeEstimated, cutoffX.value, props.filter.resonance)
    pts.push({ x, y: levelToY(level) })
  }
  return pts
})

const pathD = computed(() => points.value.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
const areaD = computed(() => `${pathD.value} L${GRAPH_W - PAD},${GRAPH_H - PAD} L${PAD},${GRAPH_H - PAD} Z`)

const fmtHz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`)

const svgEl = ref<SVGSVGElement | null>(null)
const dragging = ref(false)
const hover = ref(false)

function localPoint(e: PointerEvent): { x: number; y: number } | null {
  const svg = svgEl.value
  if (!svg) return null
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const loc = pt.matrixTransform(ctm.inverse())
  return { x: loc.x, y: loc.y }
}

function applyDrag(e: PointerEvent) {
  const loc = localPoint(e)
  if (!loc) return
  props.filter.cutoffHzEstimated = xToFreq(loc.x)
  props.filter.resonance = yToLevel(loc.y)
}

function onPointerDown(e: PointerEvent) {
  dragging.value = true
  ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
  applyDrag(e)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  applyDrag(e)
}
function onPointerUp() {
  dragging.value = false
}
</script>

<template>
  <div class="w-full overflow-x-auto sd-scroll">
    <svg
      ref="svgEl"
      :viewBox="`0 0 ${GRAPH_W} ${GRAPH_H}`"
      :width="GRAPH_W"
      :height="GRAPH_H"
      style="min-width: 100%"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
    >
      <line :x1="PAD" :x2="GRAPH_W - PAD" :y1="GRAPH_H - PAD" :y2="GRAPH_H - PAD" stroke="var(--color-mocha)" stroke-width="1" />

      <path :d="areaD" fill="var(--color-primary)" fill-opacity="0.14" stroke="none" />
      <path :d="pathD" fill="none" stroke="var(--color-primary)" stroke-width="2.25" stroke-linejoin="round" />

      <g
        style="cursor: pointer; touch-action: none"
        @pointerdown="onPointerDown"
        @pointerenter="hover = true"
        @pointerleave="hover = false"
      >
        <circle :cx="cutoffX" :cy="handleY" r="12" fill="transparent" />
        <line :x1="cutoffX" :x2="cutoffX" :y1="handleY" :y2="GRAPH_H - PAD" stroke="var(--color-ink-soft)" stroke-width="1" stroke-dasharray="3,3" />
        <circle
          :cx="cutoffX" :cy="handleY"
          :r="dragging || hover ? 7 : 5.5"
          :fill="dragging ? 'var(--color-skyblue)' : 'var(--color-cream)'"
          stroke="var(--color-primary)"
          stroke-width="2"
        />
        <text :x="cutoffX" :y="handleY - 12" text-anchor="middle" font-size="9" fill="var(--color-ink-soft)">
          {{ fmtHz(filter.cutoffHzEstimated) }} &middot; Q{{ Math.round(filter.resonance) }}
        </text>
      </g>
    </svg>
  </div>
</template>
