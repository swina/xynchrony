<script setup lang="ts">
// Visual, draggable graph for the 6-stage E-mu envelope (Attack1/2,
// Decay1-to-sustain/2, Release1/2), sitting above EnvelopeEditor.vue's
// precise/MIDI-learnable dials -- this is the "quick shape by eye" tool,
// the dials are the "exact value" tool. Same direct-prop-mutation pattern
// as the rest of the sound-design editors (see EnvelopeEditor.vue).
//
// Each stage's *segment width* is a pure function of its own Rate byte
// (linear, independent of the other stages) so dragging one breakpoint
// horizontally only ever changes that one stage's rate -- no shared-budget
// coupling between segments to fight with. The dashed gap between Decay2
// and Release1 is a fixed-width, non-interactive "note held" indicator,
// not real data.
//
// Only attack1/decay1/sustain/release1 currently drive audible playback
// (Voice.ts folds the 6-stage envelope into Tone's 4-stage ADSR -- see
// docs/ARCHITECTURE.md §3); stage-2 values are edited/saved here same as
// everywhere else in Sound Design mode, ahead of a real 6-stage engine.
import { ref, computed } from 'vue'
import type { Envelope } from '../../core/audio/types'

const props = defineProps<{ envelope: Envelope }>()

const GRAPH_H = 160
const MIN_SEG_W = 24
const MAX_SEG_W = 100
const HOLD_W = 44
const PAD = 14

type StageKey = 'attack1' | 'attack2' | 'decay1' | 'decay2' | 'release1' | 'release2'

interface StageDef {
  key: StageKey
  rateField: keyof Envelope
  levelField: keyof Envelope
  label: string
}

const STAGES: StageDef[] = [
  { key: 'attack1', rateField: 'attack1Rate', levelField: 'attack1Level', label: 'A1' },
  { key: 'attack2', rateField: 'attack2Rate', levelField: 'attack2Level', label: 'A2' },
  { key: 'decay1', rateField: 'decay1Rate', levelField: 'sustainLevel', label: 'D1' },
  { key: 'decay2', rateField: 'decay2Rate', levelField: 'decay2Level', label: 'D2' },
  { key: 'release1', rateField: 'release1Rate', levelField: 'release1Level', label: 'R1' },
  { key: 'release2', rateField: 'release2Rate', levelField: 'release2Level', label: 'R2' },
]
const HOLD_AFTER: StageKey = 'decay2'

function rateToWidth(rate: number): number {
  const frac = Math.min(1, Math.max(0, rate / 255))
  return MIN_SEG_W + (MAX_SEG_W - MIN_SEG_W) * frac
}
function widthToRate(width: number): number {
  const frac = Math.min(1, Math.max(0, (width - MIN_SEG_W) / (MAX_SEG_W - MIN_SEG_W)))
  return Math.round(frac * 255)
}
function levelToY(level: number): number {
  const frac = Math.min(1, Math.max(0, level / 127))
  return PAD + (GRAPH_H - 2 * PAD) * (1 - frac)
}
function yToLevel(y: number): number {
  const frac = Math.min(1, Math.max(0, (y - PAD) / (GRAPH_H - 2 * PAD)))
  return Math.round((1 - frac) * 127)
}

const points = computed(() => {
  let x = PAD
  return STAGES.map((stage) => {
    const rate = Number((props.envelope as any)[stage.rateField])
    const level = Number((props.envelope as any)[stage.levelField])
    x += rateToWidth(rate)
    const point = { key: stage.key, x, y: levelToY(level), label: stage.label }
    if (stage.key === HOLD_AFTER) x += HOLD_W
    return point
  })
})

const startPoint = computed(() => ({ x: PAD, y: levelToY(0) }))
const totalWidth = computed(() => (points.value.at(-1)?.x ?? PAD) + PAD)

const pathD = computed(() => {
  const pts = [startPoint.value, ...points.value]
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
})
const areaD = computed(() => `${pathD.value} L${points.value.at(-1)!.x.toFixed(1)},${GRAPH_H - PAD} L${PAD},${GRAPH_H - PAD} Z`)

const holdLine = computed(() => {
  const p = points.value.find((pt) => pt.key === HOLD_AFTER)
  if (!p) return null
  return { x1: p.x, x2: p.x + HOLD_W, y: p.y }
})

const svgEl = ref<SVGSVGElement | null>(null)
const draggingKey = ref<StageKey | null>(null)
const hoverKey = ref<StageKey | null>(null)

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

function prevX(key: StageKey): number {
  const idx = STAGES.findIndex((s) => s.key === key)
  if (idx <= 0) return startPoint.value.x
  const prevKey = STAGES[idx - 1].key
  const prevPoint = points.value.find((p) => p.key === prevKey)!
  return prevPoint.x + (prevKey === HOLD_AFTER ? HOLD_W : 0)
}

function onPointerDown(key: StageKey, e: PointerEvent) {
  draggingKey.value = key
  ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
  applyDrag(key, e)
}

function onPointerMove(e: PointerEvent) {
  if (!draggingKey.value) return
  applyDrag(draggingKey.value, e)
}

function applyDrag(key: StageKey, e: PointerEvent) {
  const loc = localPoint(e)
  if (!loc) return
  const stage = STAGES.find((s) => s.key === key)!
  const width = loc.x - prevX(key)
  ;(props.envelope as any)[stage.rateField] = widthToRate(width)
  ;(props.envelope as any)[stage.levelField] = yToLevel(loc.y)
}

function onPointerUp() {
  draggingKey.value = null
}
</script>

<template>
  <div class="w-full overflow-x-auto sd-scroll">
    <svg
      ref="svgEl"
      :viewBox="`0 0 ${totalWidth} ${GRAPH_H}`"
      :width="totalWidth"
      :height="GRAPH_H"
      style="min-width: 100%"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
    >
      <line :x1="PAD" :x2="totalWidth - PAD" :y1="GRAPH_H - PAD" :y2="GRAPH_H - PAD" stroke="var(--color-mocha)" stroke-width="1" />

      <path :d="areaD" fill="var(--color-primary)" fill-opacity="0.14" stroke="none" />
      <path :d="pathD" fill="none" stroke="var(--color-primary)" stroke-width="2.25" stroke-linejoin="round" />

      <line
        v-if="holdLine"
        :x1="holdLine.x1" :x2="holdLine.x2" :y1="holdLine.y" :y2="holdLine.y"
        stroke="var(--color-ink-soft)" stroke-width="2" stroke-dasharray="3,3"
      />
      <text v-if="holdLine" :x="(holdLine.x1 + holdLine.x2) / 2" :y="holdLine.y - 7" text-anchor="middle" font-size="8" fill="var(--color-ink-soft)">hold</text>

      <g
        v-for="p in points"
        :key="p.key"
        style="cursor: pointer; touch-action: none"
        @pointerdown="onPointerDown(p.key, $event)"
        @pointerenter="hoverKey = p.key"
        @pointerleave="hoverKey = null"
      >
        <circle :cx="p.x" :cy="p.y" r="10" fill="transparent" />
        <circle
          :cx="p.x" :cy="p.y"
          :r="draggingKey === p.key || hoverKey === p.key ? 6.5 : 5"
          :fill="draggingKey === p.key ? 'var(--color-skyblue)' : 'var(--color-cream)'"
          stroke="var(--color-primary)"
          stroke-width="2"
        />
        <text :x="p.x" :y="GRAPH_H - 1" text-anchor="middle" font-size="9" fill="var(--color-ink-soft)">{{ p.label }}</text>
      </g>
    </svg>
  </div>
</template>
