<script setup lang="ts">
// Wraps the existing read-only PresetBrowser.vue as a picker: choose a
// source preset from Orbit-3 (or whichever bank is loaded in Performance
// mode's library) to duplicate into the active Sound Design bank.
import { usePresetLibrary } from '../../composables/usePresetLibrary'
import PresetBrowser from '../PresetBrowser.vue'
import { X } from '@lucide/vue'

const emit = defineEmits<{ pick: [bankProg: string]; close: [] }>()
const { currentBank } = usePresetLibrary()

function handleSelect(bankProg: string) {
  emit('pick', bankProg)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="w-full max-w-lg sd-panel flex flex-col gap-3" style="background-color: var(--color-cream)">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold">Duplicate a preset from {{ currentBank?._meta.bankName ?? 'the library' }}</h3>
        <button class="sd-btn sd-btn-icon" @click="emit('close')"><X :size="14" /></button>
      </div>
      <PresetBrowser v-if="currentBank" :bank="currentBank" :active-bank-prog="null" @select="handleSelect" />
    </div>
  </div>
</template>
