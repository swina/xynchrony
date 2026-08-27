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

**Filter is patch-level, not per-layer**: `Preset.filter`/`Preset.filterEnv` (`core/audio/types.ts`), one filter for the whole patch, applied identically to every layer's `Voice`. This isn't how Orbit-3's own (unvalidated) per-layer `filterTypeRaw`/`filterCutoffRaw` data was shaped, and that's deliberate — see below. Both fields are optional on `Preset` because Orbit-3's `bank.json` predates them entirely; every Sound Design-created/duplicated preset always has both (`UserBankStore.ts`'s `createBlankPreset`/`duplicatePresetInto`, defaulting via `blankFilter()`/`blankEnvelope()` in `core/soundDesign/defaults.ts`). `FilterPanel.vue` lazily seeds them on open for any preset saved before this field existed.

**Filtering is opt-in (`Preset.filterBypassed` defaults to `true`), not active-but-"wide open"** — a real finding, not a cautious default for its own sake. A "wide open" filter (cutoff 20kHz, `Q` 0.707 — literally the least intrusive setting the UI allows) is not acoustically transparent: confirmed live on a duplicated `hit:Intruder`, which layers `HARD syn C4` + `808 CYM` + a short tight-looped `MINI sin C5` (a near-pure sine, effectively masked under the other two in the dry mix). Enabling even that "wide open" lowpass measurably rolled off `808 CYM`'s ultra-high content — cymbals carry real energy up near 20kHz — which was enough to dull it and let the previously-masked sine layer read as a dominant "beep". Switching the same cutoff/`Q` to `allpass` (phase-only, no magnitude change) sounded identical to bypassed, confirming the mechanism: it's the lowpass's inherent rolloff, not a bug in the filter node or its wiring. There is no cutoff value that's simultaneously "has real headroom to be useful" and "byte-for-byte identical to unfiltered" for every possible layer mix, so a fresh duplicate/blank preset starts with the filter fully out of the chain (`Voice.ts`'s `!preset.filterBypassed` check) — the user opts in via the Filter tab's "Enable filter" checkbox when they actually want to shape the sound, and a preset that already had `filterBypassed` unset (duplicated before this default existed) gets it retroactively defaulted to `true` the next time `FilterPanel.vue` opens it.

**Orbit-3's own per-layer `filterTypeRaw`/`filterCutoffRaw` bytes are never read for playback, full stop** — not a tuning choice, a scope finding. Checked against the real Emulator X3 editor, `hit:Intruder`'s "HARD syn C2" filter type is **"Bat Phaser"** (`Res=0`, `Freq=28.6Hz`), one of E-mu's many exotic Z-plane filter types (phasers, formant filters, multi-stage topologies) with no `BiquadFilterNode` equivalent. `filterCutoffRaw`/`filterTypeRaw` were already flagged unvalidated, but this proves the problem is worse than miscalibration: the byte-to-Hz formula assumes every voice is a simple lowpass, so for non-lowpass types it isn't just imprecise, it's answering a question that doesn't apply (a phaser's "Freq" isn't a cutoff — treating 28.6 as a lowpass cutoff Hz would silence nearly everything). Since there's no reliable way to tell which voices use a real lowpass vs. an exotic type without checking each one against the real editor, and a wrong filter estimate can silence a voice outright, `Voice.ts` simply never reads those per-layer fields for any bank — playback is driven exclusively by the patch-level `Preset.filter`/`filterEnv`, which is either absent or was explicitly set by a human through a Filter tab (real `BiquadFilterNode` types, never estimated from raw bytes).
>
> An earlier revision of this app *additionally* gated `Preset.filter` construction on the loaded bank's `_meta.source` (an `AudioEngine.isFilterEnabled`/`VoiceManager`/`Voice` `filterEnabled` flag, true only for `'user-created'`/`'sound-design-live-preview'` banks) — belt-and-suspenders on top of the check above, aimed at the same Bat-Phaser-class risk. That turned out to be stale once the patch-level filter fully replaced the per-layer one: `Preset.filter` is *never* derived from a bank's raw per-layer data regardless of source (see below), so the extra gate wasn't actually protecting against anything real — it was just unconditionally silencing the Filter tab's own effect for any non-user-created bank, including Orbit-3 presets a user had just explicitly configured through that very tab (a real bug once Performance mode's own Filter tab shipped, since Orbit-3 is the default/most commonly loaded bank there). Removed; `Voice.ts` now constructs `Tone.Filter`/`Tone.Envelope` whenever `!preset.filterBypassed && preset.filter && preset.filterEnv`, regardless of which bank the preset is from. `applyModMatrix` still skips any routing targeting `filter`/`filterEnv` when neither node was built (`ModMatrixTargets.filter`/`filterEnv` stay optional for exactly this reason).
>
> The per-layer version of this (filter type/cutoff/resonance living on `Layer` instead of `Preset`) shipped first and had a real bug: `UserBankStore.duplicatePresetInto()`'s `structuredClone()` of an Orbit-3 source preset carried that layer's unvalidated Bat-Phaser-class estimate straight into the new Sound Design preset, so *duplicated* presets stayed silent even with the (since-removed) `filterEnabled` gate on — the exact problem this section describes, just relocated instead of fixed. Moving the filter to patch level and always seeding `duplicatePresetInto()`'s clone with a wide-open default (never carried over from the source) closes that gap: a freshly duplicated preset is audible immediately, and any filtering is something the user dials in deliberately via a Filter tab, never inherited.
>
> Cutoff/resonance/type edits made while a note is already sustaining are applied live (`Voice.updateFilterLive()`, called from `VoiceManager.refreshFilter()`/`AudioEngine.refreshPresetLive()` on any `currentPreset` mutation) — a voice built *without* a filter (bypassed, or `preset.filter` unset, at the moment it was triggered) can't retroactively gain one without re-triggering the note, since a filter node can't be spliced into an already-connected Tone.js chain live.
>
> Faithfully modeling E-mu's exotic filter types for the *built-in* bank would need per-type custom DSP (likely `AudioWorklet`-based for the phaser/formant types) — a real feature, not a quick fix; worth scoping as its own milestone once there's a way to identify filter type per voice from the binary (not yet located) or a reference list of which types actually appear in this bank.

Documented fidelity tradeoff: the 6-stage E-mu envelope is folded into Tone's 4-stage ADSR as a first pass (ignoring stage-2 values when they're at their no-op defaults). Revisit with a custom multi-stage envelope only if A/B listening shows it's audibly wrong for specific presets (pads/sweeps most likely).

**Amp/Aux envelope scope (own/group/whole-patch)**: real Emulator X3 has "three envelope generators per voice" (Manual.pdf p.132) with no hardware concept of a literally shared envelope object — the closest real feature is Manual.pdf p.93's Groups, a pure editing-time convenience (tag several voices with a group number, select the group, edit them together; each voice still stores its own independent envelope data). Sound Design replicates the user-facing *effect* (edit once, every layer in the group sounds it together) as a true shared object instead — `Layer.ampEnvScope`/`auxEnvScope` (`core/audio/types.ts`) is `{kind:'own'}` (default), `{kind:'global'}` (points at `Preset.ampEnv`/`auxEnv`), or `{kind:'group', groupId}` (points at one of `Preset.layerGroups[]`'s `ampEnv`/`auxEnv`). `core/soundDesign/envelopeScope.ts`'s `resolveAmpEnvelope`/`resolveAuxEnvelope` are the single source of truth both `Voice.ts` (playback) and `EnvelopeScopeEditor.vue` (editing) use, so they can never disagree about which envelope is actually sounding. Falls back to the layer's own envelope if a referenced group/global target is missing (legacy data, or a deleted group). Aux Envelope isn't wired to playback at all yet (pre-existing gap, see the Voice chain diagram above) — scope only has an audible effect for Amp Envelope today.

**`applyModMatrix`**: one routing table mapping confirmed `(source, destination)` pairs to Tone.js wiring. Unrecognized pairs are logged once and skipped — safe degrade to unmodulated sound.

**Effects (Preset FX + Global/Aux FX)**: real Emulator X3 (Manual.pdf p.154-155, p.231-260) sends every voice through Main + 3 Aux levels into a per-preset Wet/Dry-fed **Preset FX** (2 slots, A→B in series, 16 possible algorithms), while **Aux/Multi FX** sums the Aux sends from *every* voice/channel at the Multisetup level — a global, always-on stage independent of any one preset. This app plays one preset at a time (no Multisetup/multi-channel concept), and implements a deliberately simplified subset — confirmed with the user before building:
- **v1 algorithm catalog (6 of 16)**: `reverb` (`Tone.Freeverb` — not `Tone.Reverb`, which is convolution-based with an async `ready` promise unsuited to live-dragged params), `delay` (`Tone.FeedbackDelay`), `chorus` (`Tone.Chorus`), `eq4` (a new composite — 4× `Tone.Filter` in series: lowshelf→peaking→peaking→highshelf, reusing the exact gain-param handling from the patch-level Filter's shelf/peaking types), `compressor` (`Tone.Compressor` + a trailing `Tone.Gain` for makeup), `phaser` (`Tone.Phaser`). See `EFFECT_PARAM_SCHEMAS` in `core/audio/effects.ts` for exactly which manual parameters made the cut per algorithm and which didn't (e.g. Delay's independent L/R times and 4 routing modes collapse to one mono-ish delay line). Deferred, not blocked: Flanger, Growl, Limiter, BPM-synced variants, the alternate reverbs.
- **Preset FX = a simple insert chain**, not the full per-voice Main/Aux1-3 send architecture: `EffectChain` (`core/audio/effects.ts`) is `input -> [dry tap] -> CrossFade.a` / `input -> [wet tap] -> SlotA? -> SlotB? -> CrossFade.b`, `CrossFade.fade = wetDry/100 -> output`. **One `EffectChain` instance per active preset, owned by `VoiceManager`** (rebuilt in `setPreset()` from `preset.fx`, falling back to a fully-dry `blankEffectChainConfig()` when absent — safe no-op for Orbit-3, which has no equivalent field) — every voice of that preset connects into the *same* shared instance rather than each getting its own, so simultaneous notes (a chord, "true layering") share one reverb "room" instead of each spawning an independent tail. `VoiceOptions.destination` is `fxChain.input`, not the raw master bus, for exactly this reason.
- **Aux/Multi FX → one global chain on `AudioEngine`'s master bus** (`masterGain -> globalFxChain -> destination`, meter taps the FX output so the VU meter reflects final audible sound), independent of whichever preset/bank is loaded — the natural mapping for "applies across every channel" onto an app with no channel concept. Its config isn't Bank/Preset data — it's app-wide, persisted via `composables/useGlobalFx.ts` (localStorage, `emulatorx3.globalFx`), UI in `TopBar.vue`'s FX popover (reuses `EffectSlotEditor.vue`, the same component `FxPanel.vue`'s Preset FX tab uses).
- **Mod Matrix gained 4 sources / 1 destination**, the "practical" subset of Manual.pdf p.156-160's ~40/~35 catalog (the rest — Function Generators, Lag Processors, Poly Key Timer, Clock Divisors, TwistaLoop, Key CC Window, the Summing Amp/Switch/Diode/Flip-Flop/Quantizer utility nodes — are each their own subsystem, left backlog): `pitchWheel` (live, bipolar, fed by the same MIDI pitch-bend handler that already drives the static per-voice retune), `key` (one-time at note-on like `velocity`, note number normalized), `gate` (per-voice `Tone.Signal`, 1 while held / 0 on release — unlike the others, one instance *per Voice*, not shared), `pressure` (live, fed by newly-parsed MIDI channel-pressure/aftertouch, `0xD0` — previously unparsed), and destination `wetDryMix` (targets the active preset's `EffectChain.wetDryFade`). Pedal/assignable-CC sources needed no new code — already covered by the existing generic `midiCC` override field on a slot.

## 4. Web MIDI

`MidiInput.ts` wraps `navigator.requestMIDIAccess` (native, no npm package): note-on/off (velocity-0 note-on = note-off), CC1 → mod wheel, pitch bend, CC123 → panic, hot-plug via `onstatechange`. `VirtualKeyboard.vue` calls the exact same `VoiceManager.noteOn/noteOff` as MIDI — one trigger path regardless of input source.

## 5. IndexedDB caching

On-demand, per-sample raw-bytes caching, decoded fresh each session (not blanket precache, not persisted decoded buffers — `decodeAudioData` is cheap; the network fetch is the only part worth caching). `SampleCache.getDecoded(bankId, zone)`: in-memory Map → IndexedDB `wav_samples` store (keyed `${bankId}:${sampleName}`) → `fetch('/wav/' + bankId + '/' + zone.wavFile)` write-through → `decodeAudioData`. Plain `indexedDB` API, no dependency.

## 6. PWA

`generateSW` strategy. Precache: app shell + `manifest.json` + every `bank.json`. Explicitly excludes `public/wav/**` (handled by IndexedDB instead — see `vite.config.ts`'s `globIgnores`).

## 7. Build order

M1 (data pipeline) → M2 (scaffold + this doc) → M3 (core audio engine) → M4 (MIDI + UI) → M5 (PWA + IndexedDB) → M6 (polish: filter curve refinement, per-voice meters, envelope-approximation revisit). See the approved plan for phase-by-phase verification steps.
