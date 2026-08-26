# Xynchrony — Architecture

A browser-based synthesizer for E-mu EOS/E4B sound banks. Vue 3 + Vite + TypeScript, Tailwind CSS, Tone.js as a DSP toolkit (not `Tone.Sampler`), the native Web MIDI and Web Audio APIs, and IndexedDB for on-demand audio caching. Ships as an installable PWA.

This document is the standing reference for the format, schema, and engine design — update it alongside the code, not just at project start.

## 1. Data pipeline: `tools/build_bank.py`

A generic CLI that turns any E-mu EOS/E4B bank into a self-contained bank JSON the frontend can load:

```
python3 tools/build_bank.py \
  --e4b /path/to/AnyBank.e4b \
  --wav-dir /path/to/WAV \
  --ebl-dir /path/to/SamplePool \
  --bank-id my-bank --bank-name "My Bank"
```

- `--e4b` (required): the compiled bank. Source of presets, layers, zones, envelopes, LFOs, mod matrix.
- `--wav-dir` (required): browser-playable WAV exports, matched to each zone by sample name.
- `--ebl-dir` (optional): raw per-sample `.ebl` files. Their own embedded names (fuller/untruncated) are used as a fallback when the E4B's 16-char-truncated sample name doesn't cleanly resolve to a WAV filename.

Output: `public/data/banks/<bank-id>/bank.json` + an upserted entry in `public/data/banks/manifest.json`. WAV files are mirrored separately by `npm run sync-assets` (see `scripts/banks.config.mjs`), not copied by `build_bank.py` itself — re-running the parser after a code change shouldn't re-copy tens of MB of audio.

### 1.1 E4B format reference (hardware-verified, third-party)

Format documented by the [mpc2emu project](https://github.com/lentferj/mpc2emu) (`docs/E4B_FORMAT.md`), reverse-engineered and verified against real E-mu E4XT/K2000R hardware. Container: `FORM <size> E4B0 / TOC1 (32-byte entries) / E4Ma / E4P1 (preset) x N / E3S1 (sample) x N / EMSt`.

**Terminology**: the E4B binary's "voice" is called a **Layer** throughout this codebase, reserving **Voice** for "one polyphonic sound-producing instance spawned at note-on" in the audio engine. These are different concepts — conflating them was a real source of confusion during development.

Each `E4P1` preset: 82-byte header (name, `num_voices`) + that many Layer blocks back-to-back. Each Layer: 284 fixed bytes + `n_zones × 22` zone bytes + 2 trailing zero bytes (last layer in the preset only).

**Layer Parameters — bytes `0:110`**:

| Offset | Field | Notes |
|---|---|---|
| `2:4` (u16 BE) | zone-table trailer offset | `284 + n_zones × 22`; drives the walk to the next layer |
| `28:30` (u16 BE) | `delayMs` | 0–10000 ms |
| `34:35` (i8) | `transposeSemitones` | signed |
| `36:37` (i8) | `fineTuneCents` | signed |
| `38:39` | `nonTranspose` | 0x01 = pitch fixed, 0x00 = key-tracking |
| `54:55` (i8) | `volumeDb` | single-zone layers |
| `55:56` (i8) | `pan` | -64..+63, single-zone layers |
| `58:59` | `filterTypeRaw` | enum, **not validated** — `typeEstimated` always defaults to `"lowpass"` |
| `60:61` | `filterCutoffRaw` | 0–255, **not validated** exponential-Hz estimate in `cutoffHzEstimated` |
| `61:62` | `filterResonance` | 0–127 linear |

**Primary Zone Table (PZT) — bytes `110:174`** (64 bytes):
- Amp Envelope `PZT[0:12]`: Attack1 rate/level, Attack2 rate/level, Decay1 rate/**sustain level**, Decay2 rate/level, Release1 rate/level, Release2 rate/level.
- Filter Envelope `PZT[14:26]`: same 6-stage layout.
- Aux Envelope `PZT[28:40]`: 6 stages but **disk order is A1,D1,R1,A2,D2,R2** — the parser remaps this into the same field-naming convention as the other two envelopes, keeping the raw order in `_rawStageOrder`.
- LFO1 `PZT[42:47]`, LFO2 `PZT[50:55]`: rate, shape (0=triangle,1=sine,2=sawtooth,3=square), delay, variation, sync (0=keySync, 1=freeRun).
- `PZT[174:190]`: 16 zero-padding bytes.

  **Caveat on the trailing 2 bytes of each envelope** (`PZT[12:14]`/`[26:28]`/`[40:42]`): mpc2emu's doc describes these as a constant `0x03 0x00` marker. Empirically, against real Orbit-3 data, that is **not reliably true** — every single envelope in the bank reads something other than that constant. The envelope *values themselves* vary sensibly and correctly grouped by underlying instrument (validated: `HARD syn C2/C3/C4` and `MINI sin C2-C6` all share one envelope shape, `808 CYM` in the same preset has a distinctly different one), so the offset math for the 12 data bytes is trusted; the trailing 2 bytes are preserved as `modeMarker` (hex string) for forensic use rather than asserted against.

**Modulation Matrix — bytes `190:270`** (20 × 4-byte slots `[source, destination, amount, flag]`):

| Known source IDs | | Known destination IDs | |
|---|---|---|---|
| `0x50` | filterEnv | `0x30` | pitch |
| `0x60` | lfo1Bipolar | `0x38` | filterFreq |
| `0x61` | lfo1Unipolar | `0x39` | filterQ |
| `0x68` | lfo2Bipolar | `0x4A` | volEnvDecay |
| `0x69` | lfo2Unipolar | `0x60` | lfo1Rate |
| `0x0C` | velocity | `0x68` | lfo2Rate |
| `0x11` | modWheel | `0x40` | velocityDefault |

Amount: signed byte, `+100% = 0x7F`, `-100% = 0x81`. A slot is unused when all 4 bytes are zero. Unrecognized source/destination bytes pass through as `"raw:0xNN"` rather than crashing — mpc2emu's doc only enumerated a subset, and real presets (e.g. `hit:Intruder`) populate most/all 20 slots with a mix of known and unknown IDs. Validated: on `bpm:WoWoW Me`, slot decoding correctly surfaces `{source: "filterEnv", destination: "filterFreq", amountPct: 100.0}` — exactly the routing you'd expect from a preset named for a filter sweep.

`voice[270:284]`: 14 zero-padding bytes, then the zone table.

**Zone entry — 22 bytes** (already-parsed before this project; now also captures per-zone volume/pan):

| Offset | Field |
|---|---|
| `2` | `loKey` |
| `5` | `hiKey` |
| `6` | `loVel` |
| `9` | `hiVel` |
| `10:12` (u16 BE) | `sampleIndex` (1-based) |
| `12:14` (i16 BE) | `fineTune` |
| `14` | `rootKey` |
| `15` (i8) | `volumeDb` (multi-zone layers only) |
| `16` (i8) | `pan` (multi-zone layers only) |

Root key convention, confirmed against real data: **C3 = MIDI 60** (E-mu's octave numbering, not the C4-as-middle-C convention). Validated: samples `HARD syn C2/C3/C4` resolve to rootKey 48/60/72.

**Critical caveat, found via live testing (not in mpc2emu's doc)**: for a **single-zone layer** (`n_zones == 1`), the zone table's `loKey`/`hiKey` bytes are a **placeholder** (always `0`/`127`), not the real key range. The real range lives at the *voice/layer* level: `vpar[17]` (byte offset 17 within the 284-byte layer block, documented by mpc2emu only as "voice hi_key", never previously used by this parser) is a genuine `hiKey`. There is no separately stored `loKey` for the voice — it's implied by chaining: `loKey = previous single-zone layer's hiKey + 1`, resetting to `0` whenever `hiKey` doesn't strictly increase (which signals a new instrument/multisample group starting — e.g. a one-off effect layer, or the next octave-split family beginning). Velocity (`vpar[18]`=loVel, `vpar[21]`=hiVel) is overridden from the same voice-level fields for single-zone layers, for consistency.

This was discovered by cross-checking against a real patch editor: `hit:Intruder`'s "HARD syn C2" zone read `loKey=0, hiKey=127` (full keyboard) from the naive zone-table parse, but the actual instrument is split at F2. Reading `vpar[17]` gives exactly `53` (F2 = root 48 + 5 semitones) — confirmed self-consistent across all 9 of that preset's layers, and it also corrected `kit:GM Groove 1`'s two single-zone layers (previously misread as spurious whole-keyboard "pad" zones sounding under the whole drum map — that was never real, it was this same placeholder bug). `n_zones > 1` layers were unaffected and already correct (validated separately: `kit:GM Groove 1`'s per-key drum zones, `syn:ScreamSync 1`'s octave split).

**Known gap**: `destination: volEnvDecay` (live decay-time modulation) has no direct Web Audio/Tone.js equivalent — `Tone.Envelope.decay` is a scheduling parameter, not a live `AudioParam`. Unsupported in v1; logged and skipped. A real fix needs a custom `AudioWorkletProcessor` envelope, out of scope for now.

**Looping: sample-level "has loop data" is the whole rule.** The real Emulator X3 editor also has a per-voice/zone **Direction** setting (manual p.97): `Forward`, `Backward`, `Forward Loop`, `Backward Loop`, `One-Shot`. Earlier testing found every zone in `hit:Intruder` reads Direction=Forward -- including samples with valid loop data -- and concluded Forward meant "never loop", overriding the sample's own loop data. **That conclusion was wrong**, confirmed directly against the real app: a sample with loop data enabled loops while the note is held regardless of what Direction says; Direction doesn't gate looping at all (its actual role, if any beyond forward/backward scrub direction and One-Shot's "finish even if released early," is still unclear). The engine now loops whenever `zone.isLooping` is true (loop points read from each WAV's RIFF `smpl` chunk by `tools/build_bank.py`), full stop -- no Direction byte needed for this decision, which is convenient since it was never located in the binary despite a real search effort (a byte-diffing attempt at zone-entry offset 0 looked promising at first but turned out to be constant-per-instrument-family, not a real per-zone encoding). The "still sounds wrong with looping on" symptom that originally triggered the (incorrect) revert was actually two independent bugs active at the same time -- the amp-envelope double-connect and the filter's wrong-in-kind cutoff estimate (see below) -- confounding the result, not looping itself being wrong.

### 1.2 Zone overlap

Some notes genuinely match more than one zone at once even with the corrected key ranges above — e.g. on `kit:GM Groove 1`, note 34 matches both a broad `909KCK long7x` zone (`[0-36]`) and a narrow per-key `909KCK long7x` zone (`[34-34]`, same sample). **The engine triggers every zone matching a note+velocity simultaneously**, not just the narrowest match — this is still the right behavior for real overlaps like that one, even though the *degree* of overlap in the bank turned out to be far smaller than initially thought (most of what looked like "whole-keyboard layering" was the placeholder bug above, not intentional design).

### 1.3 Bank JSON schema (v2)

```jsonc
{
  "_meta": {
    "schemaVersion": 2,
    "bankId": "orbit-3", "bankName": "Orbit-3",
    "source": "Orbit-3.e4b",
    "rootKeyConvention": "E-mu octave convention: C3 = MIDI 60 (middle C)",
    "presetCount": 1057, "totalLayers": 2208, "totalZones": 25316,
    "unresolvedSamples": 0,
    "notes": { "filterCutoffCurve": "NOT VALIDATED ...", "filterTypeEnum": "NOT VALIDATED ..." }
  },
  "presets": {
    "000:008": {
      "name": "kit:GM Groove 1", "category": "Kit",
      "layers": [
        {
          "layerIndex": 0,
          "params": { "delayMs": 0, "transposeSemitones": 0, "fineTuneCents": 0,
                      "nonTranspose": false, "volumeDb": -3, "pan": 0,
                      "filter": { "typeRaw": 2, "typeEstimated": "lowpass", "cutoffRaw": 200,
                                  "cutoffHzEstimated": 8200, "resonance": 40 } },
          "ampEnv": { "attack1Rate":0, "attack1Level":127, "...": "...", "modeMarker": "0000" },
          "filterEnv": { "...": "same 6-stage shape" },
          "auxEnv": { "...": "remapped to the same field names, plus _rawStageOrder" },
          "lfo1": { "rate":64, "shape":"sine", "delay":0, "variation":0, "sync":"keySync" },
          "lfo2": { "rate":64, "shape":"triangle", "delay":0, "variation":0, "sync":"freeRun" },
          "modMatrix": [ { "source":"filterEnv", "destination":"filterFreq", "amountPct":45, "flag":0 } ],
          "zones": [ { "sampleIndex":1416, "sampleName":"909KCK long7x", "wavFile":"909KCK long7x.wav",
                       "sampleRate":29025, "rootKey":72, "loKey":0, "hiKey":127, "loVel":0, "hiVel":127,
                       "fineTune":0, "volumeDb":null, "pan":null } ]
        }
      ]
    }
  }
}
```

Enum tables (source/destination/shape/sync) live once in Python (`tools/build_bank.py`) and are re-exported verbatim into `src/data/modMatrixEnums.ts`, so raw-ID fallbacks stay round-trippable between the two.

### 1.4 Validation

`tools/validate_voice_params.py` decodes and pretty-prints layer params for presets whose *name* strongly predicts a distinctive envelope/filter shape ("pad" → slow attack; "stab"/"pluck" → fast attack, near-instant; "sweep"/"wow" → a mod-matrix slot targeting `filterFreq`). This is a manual plausibility check, not a fixed-expected-value test — there's no independent ground truth beyond "does this sound right." Already run once against Orbit-3 with clean results (see git history / session notes for the specific numbers).

### 1.5 Multi-bank manifest

`public/data/banks/manifest.json` lists every built bank (`id`, `name`, `presetCount`, `schemaVersion`). The frontend reads this first; with exactly one bank it skips straight to that bank's preset browser, otherwise a bank selector appears. `SampleCache` (§6) namespaces its IndexedDB keys by `bankId` since two banks could reuse a sample name.

## 2. Project layout

```
emulator-x3/
  tools/build_bank.py, validate_voice_params.py
  scripts/sync-assets.mjs, banks.config.mjs
  public/wav/<bank-id>/, public/data/banks/{manifest.json,<bank-id>/bank.json}   -- gitignored, regenerated
  src/
    core/audio/  AudioEngine.ts VoiceManager.ts Voice.ts SampleCache.ts modMatrix.ts types.ts
    core/midi/   MidiInput.ts
    data/        modMatrixEnums.ts
    composables/ useMidiInput.ts useAudioEngine.ts usePresetLibrary.ts   -- plain reactive singletons, no Pinia
    components/  BankSelector.vue PresetBrowser.vue VirtualKeyboard.vue VoiceActivityView.vue TransportBar.vue
  docs/ARCHITECTURE.md   -- this file
```

`public/wav/**` and `public/data/**` are served as static files, never imported into the JS module graph — always `fetch()` at runtime. `npm run sync-assets` (wired as `predev`/`prebuild`) mirrors each configured bank's WAV folder in, skipping files that already match by size.

## 3. Audio engine

`Tone.Sampler` can't express arbitrary overlapping per-zone key/velocity ranges or a 20-slot mod matrix, so the engine is hand-built from Tone.js primitives used as a DSP toolkit.

**`VoiceManager.noteOn(note, velocity)`**: across the active preset's `layers[]` → `zones[]`, collect **every** zone where `loKey <= note <= hiKey && loVel <= velocity <= hiVel` (confirmed true layering — §1.2). Spawn one `Voice` per matched zone, sharing its parent layer's params/envelopes/LFOs/mod-matrix as a read-only template. Track spawned voices per note for `noteOff`. Polyphony cap (default 64), release-priority-then-oldest voice stealing.

**`Voice`** (one per matched zone per note-on): `Tone.Player` (from `SampleCache`'s decoded buffer) → `Tone.Gain` (amp `Tone.Envelope`) → **[`Tone.Filter`, Sound Design banks only — see below]** → `Tone.Panner` → `Tone.Gain` (output level) → master bus. Playback rate combines `(note - rootKey + transposeSemitones)` + `fineTune`/`fineTuneCents`; `nonTranspose` pins rate to 1×.

**Filter bypassed for Orbit-3 (and any bank with auto-estimated filter data) — not a tuning choice, a scope finding**: checked against the real Emulator X3 editor, `hit:Intruder`'s "HARD syn C2" filter type is **"Bat Phaser"** (`Res=0`, `Freq=28.6Hz`), one of E-mu's many exotic Z-plane filter types (phasers, formant filters, multi-stage topologies) with no `BiquadFilterNode` equivalent. `filterCutoffRaw`/`filterTypeRaw` were already flagged unvalidated, but this proves the problem is worse than miscalibration: the byte-to-Hz formula assumes every voice is a simple lowpass, so for non-lowpass types it isn't just imprecise, it's answering a question that doesn't apply (a phaser's "Freq" isn't a cutoff — treating 28.6 as a lowpass cutoff Hz would silence nearly everything). Since there's no reliable way to tell which voices use a real lowpass vs. an exotic type without checking each one against the real editor, and a wrong filter estimate can silence a voice outright, `AudioEngine.loadBank()` only sets `filterEnabled` (threaded through `VoiceManager` → `Voice`) when the loaded `Bank._meta.source` is `'user-created'` or `'sound-design-live-preview'` — i.e. bank data whose filter type/cutoff/resonance were set explicitly via the Sound Design UI's Filter tab (real `BiquadFilterNode` types, not estimated from raw bytes). For every other bank (Orbit-3 included) the `Tone.Filter` node is still constructed (so `applyModMatrix` has something to connect to) but stays **out of the audio chain** — those voices still play filter-free. Faithfully modeling E-mu's exotic filter types for the *built-in* bank would need per-type custom DSP (likely `AudioWorklet`-based for the phaser/formant types) — a real feature, not a quick fix; worth scoping as its own milestone once there's a way to identify filter type per voice from the binary (not yet located) or a reference list of which types actually appear in this bank.

Documented fidelity tradeoff: the 6-stage E-mu envelope is folded into Tone's 4-stage ADSR as a first pass (ignoring stage-2 values when they're at their no-op defaults). Revisit with a custom multi-stage envelope only if A/B listening shows it's audibly wrong for specific presets (pads/sweeps most likely).

**`applyModMatrix`**: one routing table mapping confirmed `(source, destination)` pairs to Tone.js wiring. Unrecognized pairs are logged once and skipped — safe degrade to unmodulated sound.

## 4. Web MIDI

`MidiInput.ts` wraps `navigator.requestMIDIAccess` (native, no npm package): note-on/off (velocity-0 note-on = note-off), CC1 → mod wheel, pitch bend, CC123 → panic, hot-plug via `onstatechange`. `VirtualKeyboard.vue` calls the exact same `VoiceManager.noteOn/noteOff` as MIDI — one trigger path regardless of input source.

## 5. IndexedDB caching

On-demand, per-sample raw-bytes caching, decoded fresh each session (not blanket precache, not persisted decoded buffers — `decodeAudioData` is cheap; the network fetch is the only part worth caching). `SampleCache.getDecoded(bankId, zone)`: in-memory Map → IndexedDB `wav_samples` store (keyed `${bankId}:${sampleName}`) → `fetch('/wav/' + bankId + '/' + zone.wavFile)` write-through → `decodeAudioData`. Plain `indexedDB` API, no dependency.

## 6. PWA

`generateSW` strategy. Precache: app shell + `manifest.json` + every `bank.json`. Explicitly excludes `public/wav/**` (handled by IndexedDB instead — see `vite.config.ts`'s `globIgnores`).

## 7. Build order

M1 (data pipeline) → M2 (scaffold + this doc) → M3 (core audio engine) → M4 (MIDI + UI) → M5 (PWA + IndexedDB) → M6 (polish: filter curve refinement, per-voice meters, envelope-approximation revisit). See the approved plan for phase-by-phase verification steps.
