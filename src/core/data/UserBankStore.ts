// CRUD for user-created Sound Design banks, stored in the shared IndexedDB
// database (STORE_USER_BANKS, see db.ts). Each record wraps a full `Bank`
// object (src/core/audio/types.ts) -- the same schema tools/build_bank.py
// produces, so a user bank is playable through AudioEngine exactly like the
// built-in Orbit-3 bank, with no format translation needed.
import { toRaw } from 'vue'
import { openDb, dbGet, dbGetAll, dbPut, dbDelete, STORE_USER_BANKS } from './db'
import { blankFilter, blankEnvelope } from '../soundDesign/defaults'
import { deepClonePlain } from '../../utils/deepClone'
import type { Bank, Preset } from '../audio/types'

export interface UserBankRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  bank: Bank
}

function emptyBank(id: string, name: string): Bank {
  return {
    _meta: {
      schemaVersion: 2,
      bankId: id,
      bankName: name,
      source: 'user-created',
      rootKeyConvention: 'E-mu octave convention: C3 = MIDI 60 (middle C)',
      presetCount: 0,
      totalLayers: 0,
      totalZones: 0,
      unresolvedSamples: 0,
      notes: {},
    },
    presets: {},
  }
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `bank-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Next unused sequential "BBB:PPP" key for a bank, wrapping program 0-127
 * into successive banks -- user banks never need to fit real MIDI PC limits
 * exactly, this just keeps keys unique and sorted. */
export function nextBankProg(bank: Bank): string {
  const used = new Set(Object.keys(bank.presets))
  for (let n = 0; n < 128 * 128; n++) {
    const bankNum = Math.floor(n / 128)
    const prog = n % 128
    const key = `${String(bankNum).padStart(3, '0')}:${String(prog).padStart(3, '0')}`
    if (!used.has(key)) return key
  }
  throw new Error('Bank is full')
}

export class UserBankStore {
  private dbPromise = openDb()

  async list(): Promise<UserBankRecord[]> {
    const db = await this.dbPromise
    const records = await dbGetAll<UserBankRecord>(db, STORE_USER_BANKS)
    return records.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async load(id: string): Promise<UserBankRecord | undefined> {
    const db = await this.dbPromise
    return dbGet<UserBankRecord>(db, STORE_USER_BANKS, id)
  }

  async create(name: string): Promise<UserBankRecord> {
    const id = newId()
    const now = Date.now()
    const record: UserBankRecord = { id, name, createdAt: now, updatedAt: now, bank: emptyBank(id, name) }
    const db = await this.dbPromise
    await dbPut(db, STORE_USER_BANKS, record)
    return record
  }

  /** Imports a previously-exported Bank JSON as a new user bank (fresh id,
   * so importing the same file twice doesn't collide). Only validates the
   * minimal shape needed to not crash the app -- not a full schema check. */
  async importBank(name: string, bank: Bank): Promise<UserBankRecord> {
    if (!bank || typeof bank !== 'object' || !bank.presets || typeof bank.presets !== 'object') {
      throw new Error('Not a valid bank JSON file (missing "presets").')
    }
    const id = newId()
    const now = Date.now()
    const importedBank: Bank = { ...bank, _meta: { ...bank._meta, bankId: id, bankName: name } }
    const record: UserBankRecord = { id, name, createdAt: now, updatedAt: now, bank: importedBank }
    const db = await this.dbPromise
    await dbPut(db, STORE_USER_BANKS, record)
    return record
  }

  async save(id: string, bank: Bank): Promise<void> {
    const db = await this.dbPromise
    const existing = await dbGet<UserBankRecord>(db, STORE_USER_BANKS, id)
    if (!existing) throw new Error(`User bank ${id} not found`)
    bank._meta.presetCount = Object.keys(bank.presets).length
    bank._meta.totalLayers = Object.values(bank.presets).reduce((n, p) => n + p.layers.length, 0)
    bank._meta.totalZones = Object.values(bank.presets)
      .reduce((n, p) => n + p.layers.reduce((m, l) => m + l.zones.length, 0), 0)
    // `bank` may be a Vue reactive Proxy (e.g. activeBank.value.bank from
    // useUserBanks) -- IndexedDB's structured-clone put() can't clone a
    // Proxy. toRaw() is safe here even for nested data: reactive() never
    // rewrites the underlying target's properties, it only wraps values on
    // read, so the raw target's nested layers/zones are already plain.
    const record: UserBankRecord = { ...existing, bank: toRaw(bank), updatedAt: Date.now() }
    await dbPut(db, STORE_USER_BANKS, record)
  }

  async rename(id: string, name: string): Promise<void> {
    const db = await this.dbPromise
    const existing = await dbGet<UserBankRecord>(db, STORE_USER_BANKS, id)
    if (!existing) throw new Error(`User bank ${id} not found`)
    existing.name = name
    existing.bank._meta.bankName = name
    existing.updatedAt = Date.now()
    await dbPut(db, STORE_USER_BANKS, existing)
  }

  async remove(id: string): Promise<void> {
    const db = await this.dbPromise
    await dbDelete(db, STORE_USER_BANKS, id)
  }

  /** Deep-clones `sourcePreset` (from Orbit-3 or another user bank) into
   * `id`'s bank at the next available Bank:Prog key. The core "use the
   * current bank as a starting point" primitive for Sound Design.
   *
   * `filter`/`filterEnv` are seeded with a safe, wide-open default only
   * when the clone doesn't already have them -- true for every Orbit-3
   * source preset (that data doesn't have preset-level filter fields at
   * all, only unvalidated per-layer ones Voice.ts no longer reads).
   * `filterBypassed` also defaults to `true` (filter OFF) for the same
   * reason: even a "wide open" filter is not acoustically transparent --
   * a real 2-pole lowpass at any cutoff still rolls off ultra-high content,
   * which is enough to audibly rebalance a multi-layer patch (confirmed:
   * a duplicated `hit:Intruder` had a masked pure-sine layer become
   * audible as soon as filtering engaged, even at cutoff=20kHz/Q=0.707 --
   * see docs/ARCHITECTURE.md). So filtering is opt-in, not
   * active-but-nominally-transparent: a fresh duplicate sounds identical
   * to Performance mode until the user deliberately enables it via the
   * Filter tab. A source that's itself a Sound Design preset already has
   * valid, user-chosen filter/filterEnv/filterBypassed, which the clone
   * keeps as-is. */
  async duplicatePresetInto(id: string, sourcePreset: Preset): Promise<string> {
    const record = await this.load(id)
    if (!record) throw new Error(`User bank ${id} not found`)
    const cloned: Preset = deepClonePlain(sourcePreset)
    cloned.filter ??= blankFilter()
    cloned.filterEnv ??= blankEnvelope()
    cloned.filterBypassed ??= true
    const key = nextBankProg(record.bank)
    record.bank.presets[key] = cloned
    await this.save(id, record.bank)
    return key
  }

  /** Blank preset with no layers -- layers are added afterward via the
   * Layer editor (M9). Named parameter default gives it something sane to
   * show in a list before the user renames it. */
  async createBlankPreset(id: string, name = 'New Preset'): Promise<string> {
    const record = await this.load(id)
    if (!record) throw new Error(`User bank ${id} not found`)
    const key = nextBankProg(record.bank)
    record.bank.presets[key] = {
      name, category: null, layers: [],
      filter: blankFilter(), filterEnv: blankEnvelope(), filterBypassed: true,
    }
    await this.save(id, record.bank)
    return key
  }

  async renamePreset(id: string, bankProg: string, name: string): Promise<void> {
    const record = await this.load(id)
    if (!record) throw new Error(`User bank ${id} not found`)
    const preset = record.bank.presets[bankProg]
    if (!preset) throw new Error(`Preset ${bankProg} not found in bank ${id}`)
    preset.name = name
    await this.save(id, record.bank)
  }

  async deletePreset(id: string, bankProg: string): Promise<void> {
    const record = await this.load(id)
    if (!record) throw new Error(`User bank ${id} not found`)
    delete record.bank.presets[bankProg]
    await this.save(id, record.bank)
  }
}
