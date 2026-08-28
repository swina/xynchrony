<script setup lang="ts">
// Draggable frequency-response graph for the filter's Cutoff/Resonance,
// same "shape by eye" idea as EnvelopeDesigner.vue's envelope graph. Cutoff
// and Resonance are two SEPARATE draggable handles (a horizontal scrubber
// under the curve for Cutoff, a vertical slider beside it for Resonance) --
// a single combined XY point made it impossible to change one without
// nudging the other, which made isolating "is it the cutoff or the
// resonance" impossible while diagnosing a lowpass self-resonance issue.
// The curve itself still reflects both together, purely visual feedback
// (a stylized response shape per filter type). Mutates `filter`'s fields
// directly, same direct-prop-mutation pattern as EnvelopeDesigner.vue.
import { ref, computed } from 'vue'
import type { FilterParams } from '../../core/audio/types'

const props = defineProps<{ filter: FilterParams }>()

const GRAPH_W = 480
const GRAPH_H = 160
const PAD = 14
const RES_W = 56 // separate vertical Resonance slider, to the right of the curve

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
      return Math.min(127, base + resonance * gaussian(x, cutoffX, bumpWidth))
    }
    case 'highpass': {
      const base = stepBlend(x, cutoffX, ROLLOFF_W, BASE_LEVEL, PASS_LEVEL)
      return Math.min(127, base + resonance * gaussian(x, cutoffX, bumpWidth))
    }
    case 'bandpass':
    case 'peaking':
      return Math.min(127, BASE_LEVEL + resonance * gaussian(x, cutoffX, bumpWidth))
    case 'notch':
      return PASS_LEVEL - (PASS_LEVEL - BASE_LEVEL) * (resonance / 127) * gaussian(x, cutoffX, bumpWidth)
    case 'lowshelf': {
      const shelfLevel = PASS_LEVEL + (resonance / 127) * 45
      return stepBlend(x, cutoffX, ROLLOFF_W * 1.6, shelfLevel, PASS_LEVEL)
    }
    case 'highshelf': {
      const shelfLevel = PASS_LEVEL + (resonance / 127) * 45
      return stepBlend(x, cutoffX, ROLLOFF_W * 1.6, PASS_LEVEL, shelfLevel)
    }
    case 'allpass':
    default:
      return PASS_LEVEL
  }
}

const SAMPLES = 96
const cutoffX = computed(() => freqToX(props.filter.cutoffHzEstimated))
const resonanceY = computed(() => levelToY(props.filter.resonance))

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

// --- Cutoff handle: horizontal-only scrubber under the curve ---
const curveSvgEl = ref<SVGSVGElement | null>(null)
const draggingCutoff = ref(false)
const hoverCutoff = ref(false)

function localPoint(svg: SVGSVGElement | null, e: PointerEvent): { x: number; y: number } | null {
  if (!svg) return null
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const loc = pt.matrixTransform(ctm.inverse())
  return { x: loc.x, y: loc.y }
}

function onCutoffPointerDown(e: PointerEvent) {
  draggingCutoff.value = true
  ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
  applyCutoffDrag(e)
}
function onCutoffPointerMove(e: PointerEvent) {
  if (!draggingCutoff.value) return
  applyCutoffDrag(e)
}
function onCutoffPointerUp() {
  draggingCutoff.value = false
}
function applyCutoffDrag(e: PointerEvent) {
  const loc = localPoint(curveSvgEl.value, e)
  if (!loc) return
  props.filter.cutoffHzEstimated = xToFreq(loc.x) // y ignored -- resonance is untouched by this handle
}

// --- Resonance handle: separate vertical slider, vertical-only ---
const resSvgEl = ref<SVGSVGElement | null>(null)
const draggingRes = ref(false)
const hoverRes = ref(false)

function onResPointerDown(e: PointerEvent) {
  draggingRes.value = true
  ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
  applyResDrag(e)
}
function onResPointerMove(e: PointerEvent) {
  if (!draggingRes.value) return
  applyResDrag(e)
}
function onResPointerUp() {
  draggingRes.value = false
}
function applyResDrag(e: PointerEvent) {
  const loc = localPoint(resSvgEl.value, e)
  if (!loc) return
  props.filter.resonance = yToLevel(loc.y) // x ignored -- cutoff is untouched by this handle
}
</script>

<template>
  <div class="flex gap-2 items-stretch">
    <div class="flex-1 min-w-0">
      <svg
        ref="curveSvgEl"
        :viewBox="`0 0 ${GRAPH_W} ${GRAPH_H}`"
        style="width: 100%; height: auto; display: block"
        @pointermove="onCutoffPointerMove"
        @pointerup="onCutoffPointerUp"
        @pointerleave="onCutoffPointerUp"
      >
        <line :x1="PAD" :x2="GRAPH_W - PAD" :y1="GRAPH_H - PAD" :y2="GRAPH_H - PAD" stroke="var(--color-mocha)" stroke-width="1" />

        <path :d="areaD" fill="var(--color-primary)" fill-opacity="0.14" stroke="none" />
        <path :d="pathD" fill="none" stroke="var(--color-primary)" stroke-width="2.25" stroke-linejoin="round" />

        <!-- Cutoff: horizontal-only scrubber on the frequency axis baseline -->
        <line :x1="cutoffX" :x2="cutoffX" :y1="PAD" :y2="GRAPH_H - PAD" stroke="var(--color-ink-soft)" stroke-width="1" stroke-dasharray="3,3" />
        <g
          style="cursor: ew-resize; touch-action: none"
          @pointerdown="onCutoffPointerDown"
          @pointerenter="hoverCutoff = true"
          @pointerleave="hoverCutoff = false"
        >
          <rect :x="cutoffX - 10" :y="GRAPH_H - PAD - 10" width="20" height="20" fill="transparent" />
          <circle
            :cx="cutoffX" :cy="GRAPH_H - PAD"
            :r="draggingCutoff || hoverCutoff ? 7 : 5.5"
            :fill="draggingCutoff ? 'var(--color-skyblue)' : 'var(--color-cream)'"
            stroke="var(--color-primary)"
            stroke-width="2"
          />
          <text :x="cutoffX" :y="PAD - 4" text-anchor="middle" font-size="9" fill="var(--color-ink-soft)">
            Cutoff {{ fmtHz(filter.cutoffHzEstimated) }}
          </text>
        </g>
      </svg>
    </div>

    <!-- Resonance: separate vertical-only slider, doesn't touch cutoff -->
    <svg
      ref="resSvgEl"
      :viewBox="`0 0 ${RES_W} ${GRAPH_H}`"
      :width="RES_W"
      :height="GRAPH_H"
      class="shrink-0"
      @pointermove="onResPointerMove"
      @pointerup="onResPointerUp"
      @pointerleave="onResPointerUp"
    >
      <line :x1="RES_W / 2" :x2="RES_W / 2" :y1="PAD" :y2="GRAPH_H - PAD" stroke="var(--color-mocha)" stroke-width="2" />
      <rect
        :x="RES_W / 2 - 3" :y="resonanceY"
        width="6" :height="GRAPH_H - PAD - resonanceY"
        fill="var(--color-primary)" fill-opacity="0.25"
      />
      <text :x="RES_W / 2" :y="PAD - 4" text-anchor="middle" font-size="8" fill="var(--color-ink-soft)">Res</text>
      <g
        style="cursor: ns-resize; touch-action: none"
        @pointerdown="onResPointerDown"
        @pointerenter="hoverRes = true"
        @pointerleave="hoverRes = false"
      >
        <rect :x="RES_W / 2 - 10" :y="resonanceY - 10" width="20" height="20" fill="transparent" />
        <circle
          :cx="RES_W / 2" :cy="resonanceY"
          :r="draggingRes || hoverRes ? 7 : 5.5"
          :fill="draggingRes ? 'var(--color-skyblue)' : 'var(--color-cream)'"
          stroke="var(--color-primary)"
          stroke-width="2"
        />
      </g>
      <text :x="RES_W / 2" :y="GRAPH_H - 2" text-anchor="middle" font-size="9" fill="var(--color-ink-soft)">
        {{ Math.round(filter.resonance) }}
      </text>
    </svg>
  </div>
</template>
