# Changes Log

## 2026-08-26 (master)

### FEATURE
- Effects: new Preset FX (Sound Design's "FX" tab -- 2 slots in series,
  one Wet/Dry, per preset) and Global/Aux FX (TopBar's FX popover -- same
  2-slot model, one always-on chain on the master bus, independent of
  whichever preset/bank is loaded, persisted via `useGlobalFx.ts`). 6
  algorithms: Reverb, Delay, Chorus, 4-Band EQ, Compressor, Phaser
  (`core/audio/effects.ts`) -- scoped down from the real hardware's 16 per
  Manual.pdf p.244-260, confirmed with the user. New `Preset.fx` field;
  `VoiceManager` owns one shared `EffectChain` per active preset (not one
  per voice, so simultaneous notes share a reverb "room").
- Mod Matrix: added `pitchWheel`/`key`/`gate`/`pressure` sources and a
  `wetDryMix` destination (targets the new Preset FX chain) -- the
  "practical" subset of Manual.pdf p.156-160's modulation catalog; MIDI
  channel pressure (aftertouch, `0xD0`) is now parsed (`MidiInput.ts`),
  previously ignored.
- Amp/Aux Envelope can now be scoped per layer to "This layer only"
  (default, unchanged), "Whole patch" (one shared envelope for every
  layer), or a named "Group" (a shared envelope for just the layers that
  join it) -- `Layer.ampEnvScope`/`auxEnvScope` (`core/audio/types.ts`),
  resolved identically for playback (`Voice.ts`) and editing
  (`EnvelopeScopeEditor.vue`) via `core/soundDesign/envelopeScope.ts`.
  Checked Manual.pdf (p.93, p.132): real Emulator X3 envelopes are
  per-voice with only an editing-time "select several voices, edit
  together" convenience, not a true shared object -- this replicates the
  requested effect (edit once, every layer in the group sounds it)
  directly instead. Aux Envelope still isn't wired to playback at all
  (pre-existing gap, unrelated to this change) -- only Amp Envelope scope
  is audible.

- `FilterCurveGraph.vue`: Cutoff and Resonance are now two independent
  draggable handles (a horizontal scrubber under the curve, a separate
  vertical slider beside it) instead of one combined XY point -- the
  combined point made it impossible to change one without nudging the
  other, which was masking whether "lowpass beeps at any freq" was
  actually a cutoff or a resonance problem.
- Filter tab: "Bypass filter" debug checkbox (`Preset.filterBypassed`) to
  A/B whether an audio problem is the filter itself or the rest of the
  patch, without losing the filter's own saved settings. Repurposed as the
  permanent opt-in control (see FIX below) -- now labeled "Enable filter",
  unchecked/off by default.

### FIX
- Filter type "lowshelf"/"highshelf"/"peaking" had no audible effect
  regardless of cutoff/resonance: those are the only BiquadFilterNode
  types that use the `gain` parameter (WebAudio spec), which `Tone.Filter`
  defaults to 0dB -- a literal no-op for those three types. Never set, so
  they always behaved like a no-op filter. Now derives a gain (0..+18dB)
  from the same Resonance dial for these three types only.
- Sound Design filter still audibly changed duplicated presets even at
  "wide open" default settings (cutoff 20kHz, Q 0.707): confirmed on
  `hit:Intruder` that a real 2-pole lowpass, even wide open, rolls off
  enough ultra-high content on a bright layer (`808 CYM`) to let a
  previously-masked pure-sine layer (`MINI sin C5`) read as a dominant
  "beep" -- not a bug in the filter's wiring (switching to `allpass` at
  the same cutoff/Q sounded identical to bypassed, confirming it's the
  lowpass's inherent rolloff). No cutoff value is both useful and
  byte-for-byte transparent, so `Preset.filterBypassed` now defaults to
  `true` -- filtering is opt-in via the Filter tab, not silently active.
  `UserBankStore.ts` seeds this for new/duplicated presets;
  `FilterPanel.vue` retroactively defaults it for any preset duplicated
  before this existed.
- Sound Design filter made patches sound like a self-oscillating "beep":
  `resonanceToQ()` mapped resonance to a Q ceiling of ~20, which was
  harmless while the filter was bypassed from playback entirely, but once
  it was actually wired into the audio chain, any mid-to-high resonance
  setting rang hard at the cutoff frequency instead of passing the sample.
  Q ceiling lowered to ~9 (still audibly resonant, well short of
  self-oscillation range).
- Sound Design mode played no audio: `SampleCache` was fetching WAV files
  from `/wav/<logical-bank-id>/...` (the live-preview scratch id or a user
  bank's own UUID), but every sample physically lives under
  `/wav/orbit-3/...`. The 404 silently 200'd into `index.html` under Vite's
  dev-server fallback, so `decodeAudioData()` failed with `EncodingError`
  instead of a clear fetch error. Now always fetches from the one static
  source bank id.
- Performance mode threw `Preset ... not found in loaded bank` after
  visiting Sound Design mode: `AudioEngine` holds one loaded bank/preset at
  a time, and Sound Design's live-preview watcher overwrites it while
  active; nothing restored Performance's bank on switching back.
  `PerformanceView.vue` now re-asserts its own bank/preset on every mount
  (and remembers the last-picked preset via `usePresetLibrary`'s new
  `lastPerformancePresetKey`), the same self-healing pattern
  `SoundDesignView.vue` already used for itself.
- Filter enabling for Sound Design still produced silent audio for
  presets duplicated from Orbit-3: the filter was per-Layer, and
  `duplicatePresetInto()`'s clone carried over that layer's unvalidated
  (often near-silencing) Orbit-3 cutoff estimate as soon as filter
  playback was turned on for Sound Design data.

### FEATURE
- Filter is now patch-level (`Preset.filter`/`Preset.filterEnv`), not
  per-layer -- one filter setting applies to every layer in a patch.
  `duplicatePresetInto()`/`createBlankPreset()` always seed a safe,
  wide-open default rather than inheriting Orbit-3's per-layer estimate,
  so duplicated presets stay audible until the user deliberately dials in
  filtering via the Filter tab. `FilterPanel.vue` no longer requires a
  layer to be selected.
- Filter playback enabled (scoped): `AudioEngine.loadBank()` sets
  `filterEnabled` based on the loaded bank's `_meta.source` -- true only
  for Sound Design-authored data (`'user-created'` /
  `'sound-design-live-preview'`), never for Orbit-3, whose filter data is
  documented-unreliable (see ARCHITECTURE.md's Bat Phaser case).
- Filter Frequency/Resonance now has its own draggable frequency-response
  graph (`FilterCurveGraph.vue`), same "drawing mode by default, dials
  behind a toggle" pattern as the envelope editors.
- All envelope drawing graphs (`EnvelopeDesigner.vue`) enlarged
  (~1.7x width/height) for legibility.
- Mod Matrix: added a custom MIDI CC field per slot, wired through
  `VoiceManager`/`AudioEngine`/`MidiInput` the same way the mod-wheel
  signal already worked.
- Zone key-range assignment: new `ZoneRangeKeyboard.vue` mini keyboard
  (click/drag to set a zone's lo/hi key), dials behind a toggle.
- New `TopBar.vue` (Logo/Zen Dots wordmark, Performance/Sound Design
  switcher, Bank Selector, Current Patch, MIDI device, Master Volume,
  Panic), replacing the old header + `TransportBar.vue` (deleted).
  Sound Design mode restructured into a left pane (Bank/Preset) + tabbed
  main panel (Layers/Filter/Envelope/Aux/LFOs/Mod-Matrix) per
  `docs/plans/sound-design-ui.md`.
- Audio auto-resume: `useAudioEngine.ts` persists
  `emulatorx3.audioEnabled` in localStorage once the user enables audio;
  `App.vue` silently retries starting the AudioContext on future loads
  before falling back to the "Enable audio" button.

### DOC
- `docs/ARCHITECTURE.md` updated to describe the patch-level filter, its
  optionality on legacy Orbit-3 `Preset` data, and the duplicate-silencing
  bug/fix.
