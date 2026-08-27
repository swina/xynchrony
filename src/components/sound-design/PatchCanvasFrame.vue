<script setup lang="ts">
// Fullscreen chrome shared by FxChainEditor.vue and ModulationEditor.vue's
// patch canvases -- both are otherwise squeezed into a tab pane or popover,
// so a patch with more than a couple of nodes/routings needs more room
// than that affords. Teleports its content to <body> as a fixed overlay
// while `fullscreen` is on; `:disabled="!fullscreen"` renders it exactly
// where it already sits otherwise, so no second component instance is ever
// mounted (that would double-register each Dial's MIDI Learn `learnId` in
// useMidiLearn.ts) and in-progress node drags/cable drags survive the
// toggle. `display: contents` in the non-fullscreen case means this
// wrapper contributes no box of its own, so the caller's own layout is
// unaffected either way. See docs/plans/FX-Modulations.md.
import { ref, onMounted, onUnmounted } from 'vue'

const fullscreen = ref(false)

function toggle() {
  fullscreen.value = !fullscreen.value
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') fullscreen.value = false
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body" :disabled="!fullscreen">
    <div :class="fullscreen ? 'fixed inset-0 z-50 flex flex-col p-4' : 'contents'" :style="fullscreen ? { backgroundColor: 'var(--color-cream)' } : {}">
      <slot :fullscreen="fullscreen" :toggle="toggle" />
    </div>
  </Teleport>
</template>
