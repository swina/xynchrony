<script setup lang="ts">
// Right-click context menu for MIDI Learn -- shared by Dial.vue and
// ToggleButton.vue (any control with a `learnId`), replacing the old
// always-visible "learn"/"CCn" badge with a menu the owning control opens
// on @contextmenu. Renders via Teleport so it isn't clipped by a scrolling
// panel/canvas (same reasoning as PatchCanvasFrame.vue's fullscreen
// teleport), positioned at the click point the caller passes in.
import { computed, onMounted, onUnmounted } from 'vue'
import { useMidiLearn } from '../../composables/useMidiLearn'

const props = defineProps<{ learnId: string; x: number; y: number }>()
const emit = defineEmits<{ close: [] }>()

const midiLearn = useMidiLearn()
const isLearning = computed(() => midiLearn.learningId.value === props.learnId)
const boundCc = computed(() => midiLearn.bindings.value[props.learnId])
const statusLabel = computed(() => (boundCc.value !== undefined ? `Bound to CC${boundCc.value}` : 'Not bound'))

function learn() {
  if (isLearning.value) midiLearn.cancelLearn()
  else midiLearn.startLearn(props.learnId)
  emit('close')
}
function clear() {
  midiLearn.clearBinding(props.learnId)
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50" @click="emit('close')" @contextmenu.prevent="emit('close')">
      <div class="sd-context-menu" :style="{ left: x + 'px', top: y + 'px' }" @click.stop @contextmenu.stop.prevent>
        <div class="sd-context-menu-status">{{ statusLabel }}</div>
        <button type="button" class="sd-context-menu-item" @click="learn">
          {{ isLearning ? 'Cancel Learning' : 'MIDI Learn' }}
        </button>
        <button v-if="boundCc !== undefined" type="button" class="sd-context-menu-item" @click="clear">
          Clear MIDI Binding
        </button>
      </div>
    </div>
  </Teleport>
</template>
