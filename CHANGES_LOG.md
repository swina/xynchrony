# Changes Log

## 2026-08-29 (master)

### FIX
- The Modulation preset library (`ModulationEditor.vue`'s "Load saved
  patch") only ever exposed `saveFx`/`saveModulation` -- both always
  insert a brand-new record via `prompt()`, so once a saved patch was
  recalled and tweaked there was no way to save the edits back onto it,
  only duplicate it under a new name. Added `FxModPresetStore.
  updateModulation()` / `useFxModLibrary().updateModulation()` and a new
  overwrite "Save" icon button (enabled only while a patch is selected)
  next to "Save as…".
- Recalling a saved modulation patch (`applyPreset()`) restored
  `modMatrix`/`lfo1`/`lfo2` but never touched `Preset.modulationNodes`/
  `modulationLayout` -- since the canvas only renders nodes the user has
  explicitly placed (opt-in, see 2026-08-28's entry), a recalled patch's
  cables had no source/destination nodes to draw between and simply
  didn't render. `applyPreset()` now seeds any missing node (with a
  default layout position) for every source/destination the recalled
  slots reference. Also: `ModulationPreset` never carried
  `customMidiSources` at all, so a recalled cable referencing one would
  permanently resolve to nothing outside the exact session it was created
  in -- `ModulationPreset.customMidiSources` now round-trips them,
  re-issued under fresh ids on recall so they never collide with the
  target preset's own.
- `Uncaught TypeError: Cannot read properties of undefined (reading
  'length')` in `FxChainEditor.vue`'s `canAdd` computed
  (`chain.nodes.length`), reachable from both Sound Design's FX tab and
  the (now-relocated, see below) Global FX panel. Root cause: `preset.fx
  ??= blankFxChain()` (`SoundDesignView.vue`/`PerformanceView.vue`) and
  `useGlobalFx.ts`'s `localStorage` load only fill in when `fx` is
  missing entirely -- a chain persisted before the graph-based FX editor
  shipped is still in the legacy `{slotA,slotB,wetDry}` shape (no
  `nodes`/`edges`) and is truthy, so it sailed straight through. There was
  already a `normalizeFxChain()` for exactly this legacy shape, but it was
  only ever applied deep in the audio engine's render path, never to the
  UI-bound object. Exported it from `effects.ts` and applied it at all
  three load sites.

### FEATURE
- Glide (portamento): new `Preset.glide` (`enabled`/`curve`: `'linear' |
  'logarithmic'`/`rate`). `Tone.Player.playbackRate` is a plain number
  setter, not a connectable `Tone.Param` (can't be scheduled with native
  Web Audio ramps), so a new voice's pitch is stepped by hand on a plain
  `setInterval` (`Voice.ts`'s `startGlide()`) from the previous note's
  pitch to its own target, Linear (`start + (target-start)*t`) or
  Logarithmic (`start * (target/start)**t`, constant-ratio-per-time).
  Also usable as a live modulation destination (`glideRate` in
  `modMatrix.ts`) despite that constraint: glide rate is mirrored into a
  real `Tone.Signal` the existing `Tone.Scale`-based mod-matrix pattern
  can target normally, and the manual ramp re-reads that signal's value
  every tick, so modulating it live actually speeds up/slows down an
  in-progress glide.
- Voice Mode: `Preset.voiceMode` (`'poly' | 'mono'`) + `Preset.maxVoices`
  (UI-capped 1-16, replaces the engine's old fixed 64-voice ceiling for
  any preset that sets it -- absent keeps the old default).
  `VoiceManager.ts`'s monophonic mode is last-note-priority with legato
  retrigger: a new note always stops whatever's sounding and replaces it;
  releasing the currently-sounding note falls back to the next held note
  in a note-priority stack (gliding into it when Glide is on); releasing
  a background held note further down the stack just updates the stack,
  no retrigger.
- Latch: `Preset.latch` (`enabled`/`maxNotes`, 1-6) -- a FIFO note-hold
  buffer, not a sustain-until-toggled-off or per-key-toggle scheme
  (deliberately, per direction during planning): a latched note's
  key-up doesn't release it; a new note past the FIFO cap evicts
  (releases) the oldest. `VoiceManager.releaseAllLatched()` releases
  everything when the Latch toggle itself is switched off.
- New "Glide/Voice" tab (`GlideVoicePanel.vue`) in both Sound Design and
  Performance mode for all three of the above, following `FilterPanel.
  vue`'s existing "optional preset field, lazily seeded by its own panel,
  engine reads it defensively" pattern.

### CHANGE
- "Enable filter"/"Enable glide"/"Enable latch" changed from
  `<input type="checkbox">` to a new `ToggleButton.vue` (icon + label
  button, `Power` icon, `sd-btn`/`sd-btn-primary` styling matching the
  existing FX-node/LFO bypass buttons) that also supports MIDI Learn.
- MIDI Learn's always-visible "learn"/"CCn" pill badge (`Dial.vue`) is
  gone, replaced app-wide by a right-click context menu
  (`MidiLearnMenu.vue`, teleported, closes on outside click/Escape):
  current binding status, "MIDI Learn" (or "Cancel Learning"), and
  "Clear MIDI Binding" when one exists. A small dot on the control
  (`.sd-midi-indicator`, blue when bound, pulsing while arming) replaces
  the badge as the at-a-glance state indicator. Affects every Dial in the
  app plus the new `ToggleButton.vue`.
- `VirtualKeyboard.vue`/`VoiceActivityView.vue` moved out of each view's
  normal document flow into a fixed-bottom bar (previously just below the
  tab content, scrolled with the page). Later split into two stacked
  fixed layers (`PerformanceFooter.vue`): an always-visible toolbar
  (`.sd-fixed-toolbar`) and a keyboard+meter layer directly above it
  (`.sd-fixed-keyboard-layer`) that can be shown/hidden (new
  `useKeyboardVisibility.ts` singleton, toggled by a `Piano` icon button
  in the toolbar). `App.vue`'s `.sd-page-main` reserves bottom padding
  sized off the same visibility flag so page content is never hidden
  behind either layer, and never leaves a gap when the keyboard is
  hidden.
- MIDI device select, BPM, Master Volume, Global FX, and Panic moved out
  of `TopBar.vue` into the new fixed toolbar (`TransportToolbar.vue`) --
  "always want at hand while playing" controls belong next to the
  keyboard, not the page header. The Global FX popover now opens upward
  (`bottom-full` instead of `top-full`) since it's anchored at the bottom
  of the viewport. The Global FX button also now shows a `.sd-btn-mocha`
  background whenever the chain actually has nodes patched in (`nodes.
  length > 0`) -- a persistent "Global FX is active" indicator,
  independent of the popover-open highlight.
- `VirtualKeyboard.vue`'s key height reduced (`h-32` -> `h-20`); black
  keys rescaled proportionally (`h-20` -> `h-12`) to keep the same ~60%
  height ratio against the shorter white keys instead of looking
  oversized.

## 2026-08-28 (master)

### FIX
- **Every live mod-matrix destination silently reset to 0 the instant a
  cable connected, before `amount` even mattered** -- e.g. LFO 1 -> Amp
  Volume produced total silence (gain reset to 0, then governed only by a
  freshly-created cable's default 0% amount); LFO 1 -> Amp Pan looked like
  "not modulating" (pan reset to 0 = already-centered, so a 0%-amount
  cable was indistinguishable from doing nothing). Root cause: connecting
  a `Tone.Scale` to a `Tone.Param` (`scale.connect(targets.outGain.gain)`
  etc.) calls Tone.js's `connectSignal()` internally
  (`SignalOperator.prototype.connect`, confirmed in `node_modules/tone`
  source), which does `cancelScheduledValues(0); setValueAtTime(0, 0)` on
  the destination -- i.e. resets and overrides, not the plain additive
  native `AudioNode->AudioParam` summing every routing in `modMatrix.ts`
  was written assuming. Fix: each live destination's true pre-modulation
  value is now snapshotted once per voice, before any connection
  (`Voice.ts`), and folded into that destination's *first* cable's own
  `Tone.Scale` range (`modMatrix.ts`'s `baseFor()`/`ModMatrixTargets.
  baseValues`/`basedDestinations` -- only the first cable to a shared
  destination encodes the baseline, since the AudioParam still sums
  multiple connected Scales natively). Applies to every live destination
  (`filterFreq`, `filterQ`, `ampVolume`, `ampPan`, `lfo1Rate`/`lfo2Rate`,
  `patchLfo1Rate`/`patchLfo2Rate`, `wetDryMix`) -- this was a
  pre-existing, latent bug in the whole live-modulation mechanism, not
  specific to the two newest destinations; a `filterEnv -> filterQ` cable
  (common in imported Orbit-3 data) hit the exact Q=0 self-silencing bug
  `resonanceToQ()`'s floor was supposed to prevent, just at the connected-
  AudioParam level instead of the constructed base value.
- Patch-level LFOs (`patchLfo1`/`patchLfo2`, `VoiceManager.ts`) and
  per-layer LFOs (`Voice.ts`'s `lfo1`/`lfo2`, resolved as mod-matrix
  sources `lfo1Bipolar`/`lfo2Bipolar`) were constructed with Tone.LFO's
  default 0..1 **unipolar** output despite being named/used as bipolar
  sources -- explicitly set `min: -1, max: 1` now, so a routed LFO sweeps
  symmetrically around the destination's base value (matches the fix
  above: `base + depth * lfoValue` now genuinely swings both directions)
  instead of only ever nudging it one way from a false zero baseline.

### FEATURE
- Patch-level Modulation (`ModulationEditor.vue`, Performance and Sound
  Design modes): 9 new destinations -- `ampVolume`/`ampPan` (live,
  continuous -- target the voice's final Gain/Panner nodes), `sampleStart`
  and `envAttack`/`envDecay`/`envSustain`/`envRelease` (one-time, baked at
  note-on -- Tone.js envelope segment times and a Player's start offset
  aren't live AudioParams, same documented class of gap as the existing
  `volEnvDecay`). `patchLfo1Rate`/`patchLfo2Rate` replace `lfo1Rate`/
  `lfo2Rate` in this editor -- those targeted each layer's own per-voice
  LFO instead of the shared patch LFO the editor's LFO modules represent,
  a real bug found while building this.
- LFO Hz/tempo-sync toggle for patch-level LFOs (`Preset.lfo1`/`lfo2`):
  new `rateMode`/`syncDivision` fields, `core/audio/lfoMapping.ts`'s
  `syncDivisionToHz()` (1/128 .. 8/1, whole-note-relative). Needs a BPM
  value the app never had (`TransportBar.vue` was already removed) -- new
  global BPM field in `TopBar.vue`, persisted via new
  `composables/useGlobalTempo.ts` (same `localStorage` pattern as
  `useGlobalFx.ts`), live-applied through `AudioEngine.setGlobalTempo()` /
  `VoiceManager.setBpm()`.
- LFO Delay/Variation, previously stored/editable but never applied to
  playback for patch-level LFOs (per the field's own doc comment), now
  wired per-voice in `modMatrix.ts`'s `wrapPatchLfoSource()` -- a delay
  ramp and randomized depth jitter wrapping the *routing* rather than the
  shared oscillator itself (mutating the oscillator per-note would detune
  every other held note using the same shared LFO).
- Custom named MIDI sources (`Preset.customMidiSources`): a small,
  reusable, user-named CC source catalog cable-able from the Modulation
  canvas, distinct from the existing anonymous per-cable `midiCC`
  override.
- Modulation canvas nodes are draggable (`Preset.modulationLayout`),
  matching `FxChainEditor.vue`'s existing node-drag pattern.
- Revised the canvas from "every source/destination always shown" to
  opt-in: the canvas starts empty, the user adds a node via an
  "Add Source…"/"Add Destination…" combo (`Preset.modulationNodes`),
  same interaction shape as `FxChainEditor.vue`'s "Add node" combo.
  Removing a node cascades to delete any cables that referenced it.
  Pre-existing saved routings are lazily migrated so they never lose
  their visible nodes. LFO nodes additionally get FX-node-style chrome:
  collapsible (default collapsed) and bypassable (`Lfo.bypass`, checked
  in `modMatrix.ts` -- a bypassed LFO contributes no modulation, silently).
  Modulation canvas nodes use the new `.sd-node-mod` CSS class instead of
  `.sd-panel`.

See `docs/plans/Modulation-Plan.md` for the full as-built design.

## 2026-08-27 (master)

### FIX
- `FilterCurveGraph.vue` `levelAt()`: resonance bump for lowpass/highpass
  only appeared at resonance > 82 (out of 127) due to `Math.max(0, resonance
  - PASS_LEVEL)` — changed to `resonance` so the bump scales from 0.
- Same `PASS_LEVEL`-as-threshold bug on lowshelf/highshelf: `shelfLevel`
  showed a "cut" at resonance=0 instead of flat (0dB gain). Changed formula
  to `PASS_LEVEL + (resonance / 127) * 45`.
- Bandpass/peaking had the same threshold issue with `BASE_LEVEL` — flat
  line at resonance < 14. Changed to `resonance` directly.

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
