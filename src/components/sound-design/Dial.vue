<script setup lang="ts">
// Reusable knob control: drag (vertical) or scroll-wheel to change value,
// arrow keys while focused, click the value readout to type an exact
// number, and (when `learnId` is set) MIDI Learn -- click the small badge
// under the dial to arm learning, twiddle a physical CC knob to bind it,
// click again to clear. See docs/plans/sound-design-ui.md and
// useMidiLearn.ts for the binding model.
import { ref, computed, onMounted } from 'vue'
import { useMidiLearn } from '../../composables/useMidiLearn'

const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number
  step?: number
  label?: string
  learnId?: string
  formatValue?: (v: number) => string
  size?: number
}>(), {
  min: 0,
  max: 127,
  step: 1,
  size: 52,
})

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const midiLearn = props.learnId ? useMidiLearn() : null

const SWEEP_DEG = 270
const START_DEG = -135

const editing = ref(false)
const editValue = ref('')
const editInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

const fraction = computed(() => {
  const span = props.max - props.min
  if (span === 0) return 0
  return Math.min(1, Math.max(0, (props.modelValue - props.min) / span))
})

const angle = computed(() => START_DEG + fraction.value * SWEEP_DEG)

const trackGradient = computed(() => {
  const pct = fraction.value * SWEEP_DEG
  return `conic-gradient(from ${START_DEG}deg, var(--color-primary) 0deg ${pct}deg, var(--color-mocha) ${pct}deg ${SWEEP_DEG}deg, transparent ${SWEEP_DEG}deg 360deg)`
})

const displayValue = computed(() => {
  if (props.formatValue) return props.formatValue(props.modelValue)
  const rounded = Math.round(props.modelValue * 100) / 100
  return String(rounded)
})

function clamp(v: number): number {
  return Math.min(props.max, Math.max(props.min, v))
}

function setValue(v: number) {
  const stepped = Math.round(v / props.step) * props.step
  const clamped = clamp(Number(stepped.toFixed(6)))
  if (clamped !== props.modelValue) emit('update:modelValue', clamped)
}

let dragStartY = 0
let dragStartValue = 0

function onPointerDown(e: PointerEvent) {
  if (editing.value) return
  dragging.value = true
  dragStartY = e.clientY
  dragStartValue = props.modelValue
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  const deltaY = dragStartY - e.clientY
  const span = props.max - props.min
  const pxForFullSweep = e.shiftKey ? 600 : 150
  setValue(dragStartValue + (deltaY / pxForFullSweep) * span)
}

function onPointerUp() {
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const dir = e.deltaY > 0 ? -1 : 1
  const amount = e.shiftKey ? props.step * 10 : props.step
  setValue(props.modelValue + dir * amount)
}

function onKeydown(e: KeyboardEvent) {
  if (editing.value) return
  const amount = e.shiftKey ? props.step * 10 : props.step
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
    e.preventDefault()
    setValue(props.modelValue + amount)
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
    e.preventDefault()
    setValue(props.modelValue - amount)
  } else if (e.key === 'Home') {
    e.preventDefault()
    setValue(props.min)
  } else if (e.key === 'End') {
    e.preventDefault()
    setValue(props.max)
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    startEditing()
  }
}

function startEditing() {
  editing.value = true
  editValue.value = String(props.modelValue)
  requestAnimationFrame(() => editInput.value?.focus())
}

function commitEditing() {
  const parsed = Number(editValue.value)
  if (!Number.isNaN(parsed)) setValue(parsed)
  editing.value = false
}

function cancelEditing() {
  editing.value = false
}

const isLearning = computed(() => !!props.learnId && midiLearn?.learningId.value === props.learnId)
const boundCc = computed(() => (props.learnId ? midiLearn?.bindings.value[props.learnId] : undefined))
const learnLabel = computed(() => (boundCc.value !== undefined ? `CC${boundCc.value}` : 'learn'))
const learnTitle = computed(() => {
  if (isLearning.value) return 'Move a MIDI controller to bind (click to cancel)'
  if (boundCc.value !== undefined) return `Bound to CC${boundCc.value} -- click to clear`
  return 'Click, then move a MIDI controller to bind (MIDI Learn)'
})

function toggleLearn() {
  if (!midiLearn || !props.learnId) return
  if (isLearning.value) midiLearn.cancelLearn()
  else if (boundCc.value !== undefined) midiLearn.clearBinding(props.learnId)
  else midiLearn.startLearn(props.learnId)
}

// Deliberately NOT unregistered on unmount: MIDI Learn should keep working
// while this dial is off-screen (a different tab/panel, a collapsed FX
// node, a preset not currently showing) -- matching how MIDI Learn behaves
// on real hardware/DAWs, and how the user actually expects to use it (set
// a binding once, keep tweaking it from a hardware controller regardless
// of which panel happens to be open). The registered closure captures
// `emit`/`props`, not anything tied to this component instance's mount
// state, and Vue's emit -> the parent's `v-model` listener -> the
// underlying reactive object mutation all keep working after unmount, as
// long as that object itself isn't discarded -- so does the deep watcher
// in useAudioEngine.ts that pushes the change to the live audio graph.
// Re-mounting the same learnId (e.g. navigating back) simply overwrites
// this entry with a fresh callback, so there's never more than one active
// registration per learnId. The only cost is a registration for a
// genuinely deleted target (e.g. a removed FX node) lingering harmlessly
// in the registry for the rest of the session, rather than being cleaned
// up immediately.
onMounted(() => {
  if (midiLearn && props.learnId) {
    midiLearn.registerCallback(props.learnId, (value01) => {
      setValue(props.min + value01 * (props.max - props.min))
    })
  }
})
</script>

<template>
  <div class="sd-dial-wrap">
    <div
      class="sd-dial"
      :style="{ '--sd-dial-size': size + 'px' }"
      tabindex="0"
      role="slider"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="modelValue"
      :aria-label="label"
      @pointerdown="onPointerDown"
      @wheel="onWheel"
      @keydown="onKeydown"
      @dblclick="startEditing"
    >
      <div class="sd-dial-track" :style="{ background: trackGradient }" />
      <div class="sd-dial-face">
        <div class="sd-dial-pointer" :style="{ transform: `rotate(${angle}deg)` }" />
      </div>
    </div>

    <input
      v-if="editing"
      ref="editInput"
      v-model="editValue"
      type="text"
      inputmode="decimal"
      class="sd-dial-edit-input"
      @keydown.enter="commitEditing"
      @keydown.escape="cancelEditing"
      @blur="commitEditing"
      @click.stop
    />
    <button v-else type="button" class="sd-dial-value" title="Click to type a value" @click="startEditing">
      {{ displayValue }}
    </button>

    <div v-if="label" class="sd-dial-label">{{ label }}</div>

    <button
      v-if="learnId"
      type="button"
      class="sd-dial-learn"
      :class="{ 'is-bound': boundCc !== undefined, 'is-learning': isLearning }"
      :title="learnTitle"
      @click="toggleLearn"
    >
      {{ learnLabel }}
    </button>
  </div>
</template>
