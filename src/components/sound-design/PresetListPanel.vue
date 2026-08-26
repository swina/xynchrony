<script setup lang="ts">
// Presets within the active editable user bank: new (blank), rename,
// delete, and "Duplicate from Orbit-3..." -- the primary way to start a
// new patch per the user's own framing ("the current bank is a starting
// point"). See approved plan Part 2 / M8.
import { ref, computed } from 'vue'
import { usePresetLibrary } from '../../composables/usePresetLibrary'
import { useUserBanks } from '../../composables/useUserBanks'
import DuplicateFromOrbit3Modal from './DuplicateFromOrbit3Modal.vue'
import { Plus, Copy, Pencil, X } from '@lucide/vue'

const { currentBank } = usePresetLibrary()
const {
  activeBank, activePresetKey,
  createBlankPreset, renamePreset, deletePreset, duplicatePresetFromOrbit3,
} = useUserBanks()

const showDuplicateModal = ref(false)

const presetEntries = computed(() => {
  if (!activeBank.value) return []
  return Object.entries(activeBank.value.bank.presets).sort(([a], [b]) => a.localeCompare(b))
})

async function handleNewBlank() {
  await createBlankPreset()
}

async function handlePick(sourceBankProg: string) {
  showDuplicateModal.value = false
  if (!currentBank.value) return
  const sourcePreset = currentBank.value.presets[sourceBankProg]
  if (sourcePreset) await duplicatePresetFromOrbit3(sourcePreset)
}

async function handleRename(bankProg: string, currentName: string) {
  const name = prompt('Rename preset', currentName)
  if (!name || !name.trim()) return
  await renamePreset(bankProg, name.trim())
}

async function handleDelete(bankProg: string, name: string) {
  if (!confirm(`Delete preset "${name}"?`)) return
  await deletePreset(bankProg)
}
</script>

<template>
  <div v-if="activeBank" class="sd-panel flex flex-col gap-2 w-72 shrink-0">
    <h2 class="sd-panel-title">Presets in "{{ activeBank.name }}"</h2>

    <div class="flex gap-2">
      <button class="sd-btn flex-1 text-sm inline-flex items-center justify-center gap-1" @click="handleNewBlank"><Plus :size="14" /> New blank</button>
      <button class="sd-btn sd-btn-primary flex-1 text-sm inline-flex items-center justify-center gap-1" @click="showDuplicateModal = true"><Copy :size="14" /> Duplicate from Orbit-3&hellip;</button>
    </div>

    <div class="rounded-lg border sd-divide max-h-64 overflow-y-auto sd-scroll" style="border-color: var(--color-mocha)">
      <div
        v-for="[bankProg, preset] in presetEntries"
        :key="bankProg"
        class="sd-row flex items-center justify-between gap-2 px-3 py-2 cursor-pointer"
        :class="bankProg === activePresetKey ? 'sd-row-active' : ''"
        @click="activePresetKey = bankProg"
      >
        <div class="min-w-0">
          <div class="truncate text-sm">{{ preset.name }}</div>
          <div class="text-xs" style="color: var(--color-ink-soft)">{{ bankProg }} &middot; {{ preset.layers.length }} layer(s)</div>
        </div>
        <div class="flex gap-1 shrink-0">
          <button class="sd-btn sd-btn-icon" title="Rename" @click.stop="handleRename(bankProg, preset.name)"><Pencil :size="14" /></button>
          <button class="sd-btn sd-btn-icon sd-btn-danger" title="Delete" @click.stop="handleDelete(bankProg, preset.name)"><X :size="14" /></button>
        </div>
      </div>
      <div v-if="presetEntries.length === 0" class="px-3 py-4 text-sm text-center" style="color: var(--color-ink-soft)">
        No presets yet.
      </div>
    </div>

    <DuplicateFromOrbit3Modal
      v-if="showDuplicateModal"
      @pick="handlePick"
      @close="showDuplicateModal = false"
    />
  </div>
</template>
