<script setup lang="ts">
// Two stacked fixed-bottom layers -- identical in both Performance and
// Sound Design mode (PerformanceView.vue/SoundDesignView.vue):
//   1. .sd-fixed-toolbar (TransportToolbar -- MIDI/BPM/Master Volume/
//      Global FX/Panic, plus the keyboard show/hide toggle): always
//      visible, pinned to the very bottom of the viewport.
//   2. .sd-fixed-keyboard-layer (VoiceActivityView + VirtualKeyboard):
//      sits directly above the toolbar, toggled by useKeyboardVisibility()
//      (the toolbar's Piano button).
// App.vue reserves matching bottom padding on <main> (sized off the same
// visibility flag) so page content never sits behind either layer.
import VirtualKeyboard from './VirtualKeyboard.vue'
import VoiceActivityView from './VoiceActivityView.vue'
import TransportToolbar from './TransportToolbar.vue'
import { useKeyboardVisibility } from '../composables/useKeyboardVisibility'

const { visible } = useKeyboardVisibility()
</script>

<template>
  <div v-if="visible" class="sd-fixed-keyboard-layer">
    <VoiceActivityView />
    <VirtualKeyboard />
  </div>
  <div class="sd-fixed-toolbar">
    <TransportToolbar />
  </div>
</template>
