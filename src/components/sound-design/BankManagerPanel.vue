<script setup lang="ts">
// List/create/rename/delete user banks, plus export-as-JSON (blob download
// -- a real webapp, not an Artifact sandbox, so this works normally) and
// import-from-JSON. See docs/ARCHITECTURE.md / approved plan Part 2.
import { ref } from 'vue'
import { useUserBanks } from '../../composables/useUserBanks'
import { Upload, Pencil, Download, X } from '@lucide/vue'

const { banks, activeBankId, createBank, renameBank, deleteBank, importBank } = useUserBanks()

const newBankName = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const error = ref<string | null>(null)

async function handleCreate() {
  const name = newBankName.value.trim()
  if (!name) return
  await createBank(name)
  newBankName.value = ''
}

async function handleRename(id: string, currentName: string) {
  const name = prompt('Rename bank', currentName)
  if (!name || !name.trim()) return
  await renameBank(id, name.trim())
}

async function handleDelete(id: string, name: string) {
  if (!confirm(`Delete bank "${name}"? This cannot be undone.`)) return
  await deleteBank(id)
}

function handleExport(record: (typeof banks.value)[number]) {
  const blob = new Blob([JSON.stringify(record.bank, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${record.name.replace(/[^\w\-]+/g, '_')}.bank.json`
  a.click()
  URL.revokeObjectURL(url)
}

function triggerImport() {
  fileInput.value?.click()
}

async function handleFileChosen(event: Event) {
  error.value = null
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const bank = JSON.parse(text)
    const name = file.name.replace(/\.bank\.json$|\.json$/i, '') || bank._meta?.bankName || 'Imported bank'
    await importBank(name, bank)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}
</script>

<template>
  <div class="sd-panel flex flex-col gap-2 w-72 shrink-0">
    <div class="flex items-center justify-between">
      <h2 class="sd-panel-title">My Banks</h2>
      <div class="flex gap-2">
        <button class="sd-btn inline-flex items-center gap-1" @click="triggerImport"><Upload :size="14" /> Import JSON</button>
        <input ref="fileInput" type="file" accept=".json" class="hidden" @change="handleFileChosen" />
      </div>
    </div>

    <div v-if="error" class="text-xs" style="color: var(--color-danger)">{{ error }}</div>

    <div class="flex gap-2">
      <input
        v-model="newBankName"
        type="text"
        placeholder="New bank name&hellip;"
        class="sd-input flex-1 text-sm"
        @keydown.enter="handleCreate"
      />
      <button class="sd-btn sd-btn-primary text-sm" @click="handleCreate">New</button>
    </div>

    <div class="rounded-lg border sd-divide max-h-56 overflow-y-auto sd-scroll" style="border-color: var(--color-mocha)">
      <div
        v-for="b in banks"
        :key="b.id"
        class="sd-row flex items-center justify-between gap-2 px-3 py-2 cursor-pointer"
        :class="b.id === activeBankId ? 'sd-row-active' : ''"
        @click="activeBankId = b.id"
      >
        <div class="min-w-0">
          <div class="truncate text-sm">{{ b.name }}</div>
          <div class="text-xs" style="color: var(--color-ink-soft)">{{ Object.keys(b.bank.presets).length }} preset(s)</div>
        </div>
        <div class="flex gap-1 shrink-0">
          <button class="sd-btn sd-btn-icon" title="Rename" @click.stop="handleRename(b.id, b.name)"><Pencil :size="14" /></button>
          <button class="sd-btn sd-btn-icon" title="Export" @click.stop="handleExport(b)"><Download :size="14" /></button>
          <button class="sd-btn sd-btn-icon sd-btn-danger" title="Delete" @click.stop="handleDelete(b.id, b.name)"><X :size="14" /></button>
        </div>
      </div>
      <div v-if="banks.length === 0" class="px-3 py-4 text-sm text-center" style="color: var(--color-ink-soft)">
        No banks yet &mdash; create one above.
      </div>
    </div>
  </div>
</template>
