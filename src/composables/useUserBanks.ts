// Plain module-level reactive singleton (no Pinia -- see
// docs/ARCHITECTURE.md / approved plan's stack-discipline note), mirroring
// usePresetLibrary.ts's pattern. Wraps UserBankStore and holds the Sound
// Design UI's current selection (bank/preset/layer/zone).
import { ref, computed } from 'vue'
import { UserBankStore, type UserBankRecord } from '../core/data/UserBankStore'
import type { Bank, Preset } from '../core/audio/types'

const store = new UserBankStore()

const banks = ref<UserBankRecord[]>([])
const activeBankId = ref<string | null>(null)
const activePresetKey = ref<string | null>(null)
const activeLayerIndex = ref<number | null>(null)
const activeZoneIndex = ref<number | null>(null)

const activeBank = computed(() => banks.value.find((b) => b.id === activeBankId.value) ?? null)
const activePreset = computed<Preset | null>(() => {
  if (!activeBank.value || !activePresetKey.value) return null
  return activeBank.value.bank.presets[activePresetKey.value] ?? null
})

async function refresh(): Promise<void> {
  banks.value = await store.list()
}

async function createBank(name: string): Promise<UserBankRecord> {
  const record = await store.create(name)
  await refresh()
  activeBankId.value = record.id
  activePresetKey.value = null
  return record
}

async function renameBank(id: string, name: string): Promise<void> {
  await store.rename(id, name)
  await refresh()
}

async function importBank(name: string, bank: Bank): Promise<UserBankRecord> {
  const record = await store.importBank(name, bank)
  await refresh()
  activeBankId.value = record.id
  activePresetKey.value = null
  return record
}

async function deleteBank(id: string): Promise<void> {
  await store.remove(id)
  if (activeBankId.value === id) {
    activeBankId.value = null
    activePresetKey.value = null
  }
  await refresh()
}

/** Persists the active bank's current (possibly live-edited, mutated
 * in-place) state to IndexedDB, WITHOUT reloading `banks` from the DB
 * afterward. The in-memory reactive object already IS the source of
 * truth being edited -- refreshing here would swap it for a freshly
 * deserialized (non-identical) object on every autosave tick, which is
 * exactly wrong mid-edit (e.g. while dragging an envelope slider: the
 * bound v-model would visibly jump as its backing object got replaced).
 * Used by SoundDesignView's debounced autosave watcher. */
async function persistActiveBank(): Promise<void> {
  if (!activeBank.value) return
  await store.save(activeBank.value.id, activeBank.value.bank)
}

/** Same, but also refreshes `banks` from the DB -- use for explicit,
 * discrete actions (not the continuous-editing autosave path above). */
async function saveActiveBank(): Promise<void> {
  if (!activeBank.value) return
  await store.save(activeBank.value.id, activeBank.value.bank)
  await refresh()
}

async function duplicatePresetFromOrbit3(sourcePreset: Preset): Promise<void> {
  if (!activeBankId.value) throw new Error('No active user bank selected')
  const key = await store.duplicatePresetInto(activeBankId.value, sourcePreset)
  await refresh()
  activePresetKey.value = key
  activeLayerIndex.value = null
  activeZoneIndex.value = null
}

async function createBlankPreset(name?: string): Promise<void> {
  if (!activeBankId.value) throw new Error('No active user bank selected')
  const key = await store.createBlankPreset(activeBankId.value, name)
  await refresh()
  activePresetKey.value = key
  activeLayerIndex.value = null
  activeZoneIndex.value = null
}

async function renamePreset(bankProg: string, name: string): Promise<void> {
  if (!activeBankId.value) return
  await store.renamePreset(activeBankId.value, bankProg, name)
  await refresh()
}

async function deletePreset(bankProg: string): Promise<void> {
  if (!activeBankId.value) return
  await store.deletePreset(activeBankId.value, bankProg)
  if (activePresetKey.value === bankProg) {
    activePresetKey.value = null
    activeLayerIndex.value = null
    activeZoneIndex.value = null
  }
  await refresh()
}

export function useUserBanks() {
  return {
    banks,
    activeBankId,
    activeBank,
    activePresetKey,
    activePreset,
    activeLayerIndex,
    activeZoneIndex,
    refresh,
    createBank,
    renameBank,
    deleteBank,
    importBank,
    saveActiveBank,
    persistActiveBank,
    duplicatePresetFromOrbit3,
    createBlankPreset,
    renamePreset,
    deletePreset,
  }
}
