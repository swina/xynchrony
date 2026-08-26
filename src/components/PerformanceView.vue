<script setup lang="ts">
// Everything that was in App.vue before mode-switching was added -- the
// existing, working Performance mode, unchanged. Bank/audio init and the
// "Enable audio" gate stay at the App.vue level since Sound Design mode
// needs the same prerequisites (a loaded Orbit-3 bank to duplicate from,
// a started AudioEngine for live audition).
import { usePresetLibrary } from '../composables/usePresetLibrary'
import { useAudioEngine } from '../composables/useAudioEngine'
import { logPatchMapping } from '../utils/logPatchMapping'
import PresetBrowser from './PresetBrowser.vue'
import VirtualKeyboard from './VirtualKeyboard.vue'
import VoiceActivityView from './VoiceActivityView.vue'

const { currentBank } = usePresetLibrary()
const { setPreset, currentBankProg } = useAudioEngine()

function selectPreset(bankProg: string) {
  setPreset(bankProg)
  if (currentBank.value) logPatchMapping(currentBank.value, bankProg)
}
</script>

<template>
  <template v-if="currentBank">
    <VoiceActivityView />
    <PresetBrowser :bank="currentBank" :active-bank-prog="currentBankProg" @select="selectPreset" />
    <VirtualKeyboard />
  </template>
</template>
