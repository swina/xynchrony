// CRUD for the FX/Modulation preset library -- named, reusable chains that
// live independently of any Bank/Preset, recalled and applied to whichever
// patch is loaded (see docs/plans/FX-Modulations.md's "FX / Modulation
// preset library"). Mirrors UserBankStore.ts's IndexedDB pattern (a closer
// fit than useGlobalFx.ts's single-localStorage-blob approach now that this
// is a growable list of named, hand-built entries, not one always-on
// app-wide config).
import { openDb, dbGetAll, dbPut, dbDelete, STORE_FXMOD_PRESETS } from './db'
import { newId } from '../../utils/id'
import { deepClonePlain } from '../../utils/deepClone'
import type { FxChain, ModulationPreset } from '../audio/types'

export type FxModPresetRecord =
  | { id: string; name: string; kind: 'fx'; createdAt: number; data: FxChain }
  | { id: string; name: string; kind: 'modulation'; createdAt: number; data: ModulationPreset }

export class FxModPresetStore {
  private dbPromise = openDb()

  async list(kind?: FxModPresetRecord['kind']): Promise<FxModPresetRecord[]> {
    const db = await this.dbPromise
    const records = await dbGetAll<FxModPresetRecord>(db, STORE_FXMOD_PRESETS)
    const filtered = kind ? records.filter((r) => r.kind === kind) : records
    return filtered.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** `data` is deep-cloned so the saved library entry never shares an
   * object the caller's live patch is still editing. */
  async saveFx(name: string, data: FxChain): Promise<FxModPresetRecord> {
    const record: FxModPresetRecord = { id: newId('fxpreset'), name, kind: 'fx', createdAt: Date.now(), data: deepClonePlain(data) }
    const db = await this.dbPromise
    await dbPut(db, STORE_FXMOD_PRESETS, record)
    return record
  }

  async saveModulation(name: string, data: ModulationPreset): Promise<FxModPresetRecord> {
    const record: FxModPresetRecord = { id: newId('fxpreset'), name, kind: 'modulation', createdAt: Date.now(), data: deepClonePlain(data) }
    const db = await this.dbPromise
    await dbPut(db, STORE_FXMOD_PRESETS, record)
    return record
  }

  /** Overwrites an existing record's data in place (name/id/kind/createdAt
   * untouched) -- the "Save" counterpart to `saveModulation`'s "Save as…",
   * for updating a patch that was recalled via `applyPreset`. */
  async updateModulation(id: string, data: ModulationPreset): Promise<void> {
    const db = await this.dbPromise
    const records = await dbGetAll<FxModPresetRecord>(db, STORE_FXMOD_PRESETS)
    const existing = records.find((r) => r.id === id && r.kind === 'modulation')
    if (!existing) throw new Error(`Modulation preset ${id} not found`)
    existing.data = deepClonePlain(data)
    await dbPut(db, STORE_FXMOD_PRESETS, existing)
  }

  async rename(id: string, name: string): Promise<void> {
    const db = await this.dbPromise
    const records = await dbGetAll<FxModPresetRecord>(db, STORE_FXMOD_PRESETS)
    const existing = records.find((r) => r.id === id)
    if (!existing) throw new Error(`FX/Modulation preset ${id} not found`)
    existing.name = name
    await dbPut(db, STORE_FXMOD_PRESETS, existing)
  }

  async remove(id: string): Promise<void> {
    const db = await this.dbPromise
    await dbDelete(db, STORE_FXMOD_PRESETS, id)
  }
}
