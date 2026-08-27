// On-demand, per-sample raw-bytes cache: L1 in-memory Map -> IndexedDB
// (raw ArrayBuffer, keyed by `${bankId}:${sampleName}`) -> network fetch,
// write-through to IndexedDB, then decodeAudioData(). Decoded AudioBuffers
// are never persisted across sessions -- decodeAudioData is cheap; the
// network fetch is the only part worth caching. See docs/ARCHITECTURE.md §5.
import type { Zone } from './types'
import { openDb, dbGet, dbPut, dbClear, STORE_WAV_SAMPLES } from '../data/db'

// WAV audio physically lives only under /wav/<static-bank-id>/ (mirrored
// there by scripts/sync-assets.mjs from each static bank's banks.config.mjs
// entry) -- Sound Design presets (duplicated from Orbit-3 or picked via
// SamplePickerModal, which itself only ever sources from the static bank)
// reference those same sample files by name/wavFile, but get played back
// under a different *logical* bankId (the live-preview scratch id, or a
// user bank's own generated UUID). Fetching by that logical id 404s --
// which, under Vite's dev server, silently 200s into index.html instead of
// a real 404, so the failure only surfaces later as a decodeAudioData
// EncodingError. Only one static bank exists today, so this is a fixed
// constant; if a second static bank is ever added, samples will need a
// per-zone provenance field instead (see docs/ARCHITECTURE.md).
const STATIC_SAMPLE_SOURCE_BANK_ID = 'orbit-3'

interface CachedWav {
  key: string
  bytes: ArrayBuffer
  sizeBytes: number
  cachedAt: number
}

export class SampleCache {
  private audioContext: AudioContext
  private dbPromise: Promise<IDBDatabase>
  private l1 = new Map<string, AudioBuffer>()
  private inFlight = new Map<string, Promise<AudioBuffer>>()

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext
    this.dbPromise = openDb()
    void this.requestPersistence()
  }

  private async requestPersistence() {
    try {
      const estimate = await navigator.storage?.estimate?.()
      if (estimate) {
        console.log(`[SampleCache] storage estimate: ${((estimate.usage ?? 0) / 1e6).toFixed(1)}MB used / `
          + `${((estimate.quota ?? 0) / 1e6).toFixed(0)}MB quota`)
      }
      await navigator.storage?.persist?.()
    } catch {
      // storage APIs unavailable/unsupported -- non-fatal
    }
  }

  private cacheKey(bankId: string, sampleName: string): string {
    return `${bankId}:${sampleName}`
  }

  async getDecoded(bankId: string, zone: Zone): Promise<AudioBuffer> {
    if (!zone.wavFile || !zone.sampleName) {
      throw new Error(`Zone has no resolved WAV file (sampleIndex=${zone.sampleIndex})`)
    }
    return this.getDecodedByFile(bankId, zone.sampleName, zone.wavFile)
  }

  /** Same cache/fetch/decode path as getDecoded, keyed directly by name +
   * filename instead of a full Zone -- used for one-off auditioning (e.g.
   * SamplePickerModal) where there's no Zone yet, that's the whole point
   * of previewing before assigning one. */
  async getDecodedByFile(bankId: string, sampleName: string, wavFile: string): Promise<AudioBuffer> {
    const key = this.cacheKey(bankId, sampleName)

    const l1Hit = this.l1.get(key)
    if (l1Hit) return l1Hit

    const inFlightHit = this.inFlight.get(key)
    if (inFlightHit) return inFlightHit

    const promise = this.loadAndDecode(wavFile, key)
    this.inFlight.set(key, promise)
    try {
      return await promise
    } finally {
      this.inFlight.delete(key)
    }
  }

  private async loadAndDecode(wavFile: string, key: string): Promise<AudioBuffer> {
    const db = await this.dbPromise
    let bytes: ArrayBuffer

    const cached = await dbGet<CachedWav>(db, STORE_WAV_SAMPLES, key)
    if (cached) {
      bytes = cached.bytes
    } else {
      const res = await fetch(`/wav/${STATIC_SAMPLE_SOURCE_BANK_ID}/${encodeURIComponent(wavFile)}`)
      if (!res.ok) throw new Error(`Failed to fetch ${wavFile}: HTTP ${res.status}`)
      bytes = await res.arrayBuffer()
      // Write-through, fire-and-forget -- don't block audio on completion.
      const entry: CachedWav = { key, bytes, sizeBytes: bytes.byteLength, cachedAt: Date.now() }
      void dbPut(db, STORE_WAV_SAMPLES, entry)
        .catch((e) => console.warn(`[SampleCache] IndexedDB write failed for ${key}:`, e))
    }

    // decodeAudioData detaches/consumes the buffer, so hand it a copy if we
    // might need the original bytes again (we don't here, but IndexedDB's
    // structured clone on write-through has already happened async above).
    const audioBuffer = await this.audioContext.decodeAudioData(bytes.slice(0))
    this.l1.set(key, audioBuffer)
    return audioBuffer
  }

  async clearPersistentCache(): Promise<void> {
    const db = await this.dbPromise
    await dbClear(db, STORE_WAV_SAMPLES)
    this.l1.clear()
  }
}
