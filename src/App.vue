<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { usePresetLibrary } from './composables/usePresetLibrary'
import { useAudioEngine } from './composables/useAudioEngine'
import { useKeyboardVisibility } from './composables/useKeyboardVisibility'
import TopBar from './components/TopBar.vue'
import PerformanceView from './components/PerformanceView.vue'
import SoundDesignView from './components/sound-design/SoundDesignView.vue'
import { Volume2 } from '@lucide/vue'

const { currentBank, loading, error, loadManifest, loadBank } = usePresetLibrary()
const { started, previouslyEnabled, ensureStarted } = useAudioEngine()
// .sd-page-main's reserved bottom padding needs to track the keyboard
// layer's own show/hide state (PerformanceFooter.vue/TransportToolbar.vue)
// -- see main.css's --sd-toolbar-height/--sd-keyboard-layer-height.
const { visible: keyboardVisible } = useKeyboardVisibility()
const footerHeight = computed(() => (
  keyboardVisible.value ? 'calc(var(--sd-toolbar-height) + var(--sd-keyboard-layer-height))' : 'var(--sd-toolbar-height)'
))

const initError = ref<string | null>(null)
const mode = ref<'performance' | 'soundDesign'>('performance')

onMounted(async () => {
  try {
    // loadManifest() also refreshes the user-banks list internally (see
    // usePresetLibrary.ts) -- combinedManifest lists static banks first,
    // so banks[0] here is still Orbit-3, not a user bank, as long as at
    // least one static bank exists. This only populates currentBank/
    // currentBankId (usePresetLibrary's own state); loading it into
    // AudioEngine is PerformanceView.vue's job (see its onMounted), since
    // it needs to redo that every time Performance mode is re-entered, not
    // just once here at startup.
    const banks = await loadManifest()
    if (banks.length > 0) {
      await loadBank(banks[0].id)
    }
  } catch (e) {
    initError.value = e instanceof Error ? e.message : String(e)
  }

  // Best-effort silent resume for a returning visitor who's enabled audio
  // before (see useAudioEngine.ts) -- succeeds in browsers that grant
  // autoplay based on prior engagement, and is a harmless no-op otherwise
  // (the "Enable audio" button below still shows if this rejects, since
  // `started` stays false).
  if (previouslyEnabled) {
    try {
      await ensureStarted()
    } catch {
      // Browser still requires a fresh gesture this visit -- expected.
    }
  }
})

async function handleStart() {
  await ensureStarted()
}
</script>

<template>
  <main class="sd-page-main min-h-screen flex flex-col items-center gap-0 p-1" :style="{ '--sd-footer-height': footerHeight }">
    <TopBar :mode="mode" @change="mode = $event" />

    <div v-if="initError || error" style="color: var(--color-danger)">{{ initError ?? error }}</div>
    <div v-else-if="loading || !currentBank" style="color: var(--color-ink-soft)">Loading bank&hellip;</div>

    <template v-else>
      <div v-if="!started" class="flex flex-col items-center gap-3 py-8">
        <p class="text-sm max-w-sm text-center" style="color: var(--color-ink-soft)">
          Browsers require a click before audio can play. Click below to enable sound.
        </p>
        <button class="sd-btn sd-btn-primary px-5 py-2.5 font-medium inline-flex items-center gap-2" @click="handleStart">
          <Volume2 :size="16" /> Enable audio
        </button>
      </div>

      <PerformanceView v-if="mode === 'performance'" />
      <SoundDesignView v-else />
    </template>
  </main>
</template>
