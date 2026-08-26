<script setup lang="ts">
// Browse/search/audition the sample library to assign one to a zone.
// Sourced by deduping sampleName/wavFile/sampleRate across every zone in
// the already-loaded Orbit-3 bank.json -- no new build step needed, all
// 1298 samples are referenced somewhere in it. See approved plan Part 2.
import { ref, computed } from 'vue'
import { usePresetLibrary } from '../../composables/usePresetLibrary'
import { AudioEngine } from '../../core/audio/AudioEngine'
import { X, Play, Loader2 } from '@lucide/vue'

interface SampleEntry {
  sampleName: string
  wavFile: string
  sampleRate: number | null
}

const emit = defineEmits<{ pick: [entry: SampleEntry]; close: [] }>()
const { currentBank, currentBankId } = usePresetLibrary()

const search = ref('')
const previewingSample = ref<string | null>(null)

const allSamples = computed<SampleEntry[]>(() => {
  if (!currentBank.value) return []
  const seen = new Map<string, SampleEntry>()
  for (const preset of Object.values(currentBank.value.presets)) {
    for (const layer of preset.layers) {
      for (const z of layer.zones) {
        if (z.sampleName && z.wavFile && !seen.has(z.sampleName)) {
          seen.set(z.sampleName, { sampleName: z.sampleName, wavFile: z.wavFile, sampleRate: z.sampleRate })
        }
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.sampleName.localeCompare(b.sampleName))
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return allSamples.value
  return allSamples.value.filter((s) => s.sampleName.toLowerCase().includes(q))
})

async function preview(entry: SampleEntry) {
  if (!currentBankId.value) return
  previewingSample.value = entry.sampleName
  try {
    await AudioEngine.previewSample(currentBankId.value, entry.wavFile)
  } finally {
    previewingSample.value = null
  }
}

function pick(entry: SampleEntry) {
  emit('pick', entry)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="w-full max-w-lg sd-panel flex flex-col gap-3" style="background-color: var(--color-cream)">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold">Choose a sample</h3>
        <button class="sd-btn sd-btn-icon" @click="emit('close')"><X :size="14" /></button>
      </div>

      <input
        v-model="search"
        type="text"
        placeholder="Search samples&hellip;"
        class="sd-input text-sm"
      />
      <div class="text-xs" style="color: var(--color-ink-soft)">{{ filtered.length }} of {{ allSamples.length }} samples</div>

      <div class="h-80 overflow-y-auto sd-scroll rounded-lg border sd-divide" style="border-color: var(--color-mocha)">
        <div
          v-for="s in filtered"
          :key="s.sampleName"
          class="sd-row flex items-center justify-between gap-2 px-3 py-2"
        >
          <button class="flex-1 text-left truncate text-sm" @click="pick(s)">{{ s.sampleName }}</button>
          <button
            class="sd-btn sd-btn-icon shrink-0"
            :disabled="previewingSample === s.sampleName"
            @click="preview(s)"
          >
            <Loader2 v-if="previewingSample === s.sampleName" :size="14" class="animate-spin" />
            <Play v-else :size="14" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
