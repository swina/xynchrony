<script setup lang="ts">
// Reusable boolean on/off control, styled as a button/icon (not a
// checkbox) -- the "Enable filter"/"Enable glide"/"Enable latch" toggles
// use this instead of a raw <input type="checkbox">. Mirrors Dial.vue's
// MIDI Learn registration (see its header comment for the full model) but
// for a boolean instead of a ranged number: useMidiLearn's callback is
// hardcoded to a normalized 0-1 CC value (see useMidiLearn.ts) regardless
// of target type, so this component just thresholds it at 0.5 (raw CC 64)
// the same way a sustain-pedal/footswitch CC is conventionally read.
// Right-click for a context menu (MidiLearnMenu.vue) to arm learning/clear
// an existing binding, same interaction as Dial.vue.
import { ref, computed, onMounted } from 'vue'
import { useMidiLearn } from '../../composables/useMidiLearn'
import MidiLearnMenu from './MidiLearnMenu.vue'
import { Power } from '@lucide/vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  label?: string
  learnId?: string
  icon?: unknown
}>(), {
  icon: () => Power,
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const midiLearn = props.learnId ? useMidiLearn() : null

function setValue(v: boolean) {
  if (v !== props.modelValue) emit('update:modelValue', v)
}

const isLearning = computed(() => !!props.learnId && midiLearn?.learningId.value === props.learnId)
const boundCc = computed(() => (props.learnId ? midiLearn?.bindings.value[props.learnId] : undefined))

const menuOpen = ref(false)
const menuPos = ref({ x: 0, y: 0 })
function openMenu(e: MouseEvent) {
  if (!props.learnId) return
  menuPos.value = { x: e.clientX, y: e.clientY }
  menuOpen.value = true
}

// Deliberately NOT unregistered on unmount -- same reasoning as
// Dial.vue's identical registration (see its header comment): MIDI Learn
// should keep working while this button is off-screen.
onMounted(() => {
  if (midiLearn && props.learnId) {
    midiLearn.registerCallback(props.learnId, (value01) => setValue(value01 >= 0.5))
  }
})
</script>

<template>
  <div class="relative inline-flex">
    <button
      type="button"
      class="sd-btn inline-flex items-center gap-1.5"
      :class="modelValue ? 'sd-btn-primary' : ''"
      :title="label"
      @click="setValue(!modelValue)"
      @contextmenu.prevent="openMenu"
    >
      <component :is="icon" :size="14" />
      <span v-if="label">{{ label }}</span>
    </button>

    <div
      v-if="learnId && (boundCc !== undefined || isLearning)"
      class="sd-midi-indicator"
      :class="{ 'is-bound': boundCc !== undefined, 'is-learning': isLearning }"
      :title="isLearning ? 'Learning MIDI CC...' : `Bound to CC${boundCc}`"
      style="top: -3px; right: -3px"
    />

    <MidiLearnMenu v-if="learnId && menuOpen" :learn-id="learnId" :x="menuPos.x" :y="menuPos.y" @close="menuOpen = false" />
  </div>
</template>
