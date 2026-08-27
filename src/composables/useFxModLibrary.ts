// Plain module-level reactive singleton (no Pinia -- see docs/ARCHITECTURE.md),
// mirroring useUserBanks.ts's pattern. Wraps FxModPresetStore for the FX/
// Modulation preset library -- see docs/plans/FX-Modulations.md.
import { ref } from 'vue'
import { FxModPresetStore, type FxModPresetRecord } from '../core/data/FxModPresetStore'
import type { FxChain, ModulationPreset } from '../core/audio/types'

const store = new FxModPresetStore()
const records = ref<FxModPresetRecord[]>([])

async function refresh(): Promise<void> {
  records.value = await store.list()
}

async function saveFx(name: string, data: FxChain): Promise<void> {
  await store.saveFx(name, data)
  await refresh()
}

async function saveModulation(name: string, data: ModulationPreset): Promise<void> {
  await store.saveModulation(name, data)
  await refresh()
}

async function rename(id: string, name: string): Promise<void> {
  await store.rename(id, name)
  await refresh()
}

async function remove(id: string): Promise<void> {
  await store.remove(id)
  await refresh()
}

export function useFxModLibrary() {
  return { records, refresh, saveFx, saveModulation, rename, remove }
}
