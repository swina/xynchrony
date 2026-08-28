# MODULATION (as-built)

Patch-level modulation for Performance and Sound Design mode. This
revises the original short brief (kept in git history) into the locked,
as-built design, in the same style as `docs/plans/FX-Modulations.md`,
which this feature builds directly on top of (`Preset.modMatrix`,
`Preset.lfo1`/`lfo2`, the `ModulationEditor.vue` cable canvas, and the
FX/Modulation preset library all already existed before this revision;
see that doc for their original design).

Per-layer modulation (`Layer.modMatrix`, `ModMatrixEditor.vue`, imported
E4B hardware data) is out of scope here and untouched — see
"Sound Design Layers Modulations" at the bottom.

## Sources

| Source | Live/one-time | Notes |
|---|---|---|
| LFO 1 / LFO 2 (patch-level) | Live | `Preset.lfo1`/`lfo2`, one shared `Tone.LFO` pair per active preset (`VoiceManager`). Rate: Hz (0-127 byte, exponential curve, `lfoMapping.ts`'s `lfoRateToHz`) or tempo-sync (`rateMode: 'sync'`, `syncDivision` one of `1/128..8/1`, resolved against the app-wide BPM — see "Tempo sync" below). Delay/Variation apply **per-voice** (wrap the routing, not the shared oscillator — see below). Shape: triangle/sine/sawtooth/square. |
| Pitch Wheel | Live, bipolar | Fed by the MIDI pitch-bend handler, separate from the static per-voice retune. |
| Mod Wheel | Live | CC1 by MIDI convention. |
| Key | One-time | Note number, normalized 0..1, resolved at note-on. |
| Gate | Live (per-voice) | 1 while held, 0 on release. |
| Pressure | Live | Channel pressure/aftertouch (`0xD0`). |
| Velocity | One-time | Resolved at note-on. |
| Custom MIDI sources | Live | `Preset.customMidiSources`: user-named, reusable `{ name, cc }` entries, cable-able like any other source. Distinct from the per-cable `midiCC` override below — a named, catalog entry vs. an anonymous one-off. |

"Assignable CC" for Pitch Wheel/Mod Wheel/Gate/Pressure is already covered
by the existing generic per-cable `midiCC` override (every cable can be
driven by an arbitrary raw CC instead of its chosen source) — no separate
per-source CC assignment was needed.

## Destinations

| Destination | Live/one-time | Notes |
|---|---|---|
| Filter Frequency (`filterFreq`) | Live | ±4000Hz range, `filter.frequency`. |
| Filter Resonance (`filterQ`) | Live | Abs-depth only (never subtracts, to avoid re-hitting the Q≈0 degeneracy). |
| Amp Volume (`ampVolume`) | Live | Voice's final output-level `Tone.Gain.gain`. |
| Amp Pan (`ampPan`) | Live | Voice's `Tone.Panner.pan` (clamped -1..1 by the node itself). |
| Pitch (`pitch`) | **One-time** | ±1 octave range, baked into the voice's static playback-rate calc alongside transpose/fine-tune/pitch-bend — `Tone.Player.playbackRate` is a plain number setter, not a connectable `Tone.Param`. |
| Sample Start (`sampleStart`) | **One-time** | Fraction of the sample's own duration, passed as `Tone.Player.start()`'s offset — a Player's start offset can't change after playback begins. |
| Envelope Attack/Decay/Sustain/Release (`envAttack`/`envDecay`/`envSustain`/`envRelease`) | **One-time** | Bias the Amp Envelope's ADSR *before* `Tone.AmplitudeEnvelope` is constructed. Tone.js envelope segment times aren't live AudioParams (same documented gap as the pre-existing `volEnvDecay`), so these can't sweep a note that's already sustaining — they vary note-to-note instead. Scoped to the Amp Envelope only (not the Filter Envelope). |
| LFO 1 / LFO 2 Frequency (`patchLfo1Rate`/`patchLfo2Rate`) | Live | Targets the **shared patch-level** LFO pair. Distinct from the older `lfo1Rate`/`lfo2Rate` (still in the shared enum for the per-layer editor), which target each layer's own per-voice LFO — routing a patch-level cable through those was a real bug, fixed by splitting the destinations. |
| FX Wet/Dry (`wetDryMix`) | Live | Unchanged, pre-existing. |

"Key Sustain" and "Gain Level" from the original brief were resolved
during design: Key Sustain was dropped (no well-defined behavior); Gain
Level was folded into Amp Volume (same thing, one destination).
`volEnvDecay` remains the one destination with no equivalent at all, live
or one-time (no `Tone.js` hook to hang even a one-time bias off of).

## One-time vs. live modulation

Two genuinely different mechanisms, both driven by the same
`ModMatrixSlot` data:

- **Live**: a continuous Web Audio connection (`sourceSignal → Tone.Scale
  → AudioParam`), established once when the voice is built and then
  running for the voice's whole lifetime with no further code involved —
  `filterFreq`/`filterQ`/`ampVolume`/`ampPan`/`patchLfo1Rate`/
  `patchLfo2Rate`/`wetDryMix`.
- **One-time**: sampled once, synchronously, at the instant a voice is
  triggered (`computeEnvelopeAndStartOverrides()` in `modMatrix.ts`,
  called from `Voice.build()` *before* the envelope/player are
  constructed) — `pitch`, `sampleStart`, `envAttack`, `envDecay`,
  `envSustain`, `envRelease`. Works with any source that has a
  synchronously-readable "current value" at that instant: velocity, key,
  modWheel, pressure, pitchWheel, gate, and any custom-CC/`midiCC`-
  override signal. **Does not** work with `patchLfo1`/`patchLfo2` as a
  source for these destinations — an oscillator's instantaneous phase
  isn't a well-defined "current value" the way a `Tone.Signal.value` is;
  routing a patch LFO to one of these destinations is silently skipped
  (logged once, same as any other unresolvable routing).

Multiple routings to the same one-time destination sum, consistent with
how multiple live routings to one destination already combine (Web
Audio auto-sums multiple `.connect()`s onto one AudioParam).

## Tempo sync

No transport/sequencer concept exists in this app (`TransportBar.vue` was
removed early on), so tempo-sync needed a BPM value from somewhere new:
a small global BPM field in `TopBar.vue`, backed by
`composables/useGlobalTempo.ts` (plain reactive singleton, persisted to
`localStorage` under `emulatorx3.globalTempo`, default 120, clamped
20-300 — same shape as `useGlobalFx.ts`'s global config). Live-applied
through `AudioEngine.setGlobalTempo()` → `VoiceManager.setBpm()` →
`applyPatchLfoSettings()`, so changing the global BPM immediately
re-rates any patch LFO currently in `sync` mode, same as any other live
patch-LFO edit.

`core/audio/lfoMapping.ts`'s `syncDivisionToHz(division, bpm)`:
whole-note-relative — `wholeNoteSec = (60/bpm) * 4`, a division like
`'1/4'` or `'2/1'` scales that duration by `num/den`, inverted to Hz.
`SYNC_DIVISIONS` spans `1/128` through `8/1`.

## LFO Delay/Variation

Stored on `Lfo.delay`/`Lfo.variation` since before this revision, but
never applied to playback for patch-level LFOs. Since the patch LFO pair
is one shared oscillator instance per active preset (not per-voice —
`VoiceManager`), mutating its rate/phase per note-on would detune/reset
it for every other currently-held note using it. Instead,
`modMatrix.ts`'s `wrapPatchLfoSource()` wraps the *routing*, per voice:

- **Delay**: a per-voice `Tone.Gain` ramped 0→1 over `delay` seconds
  (`lfoDelayByteToSeconds`, 0-127 byte → 0-5s) starting at voice
  construction, inserted between the shared oscillator and this voice's
  own destination `Tone.Scale`.
- **Variation**: a per-voice randomized depth multiplier
  (`lfoVariationByteToDepth`, 0-127 byte → 0-30% jitter) — approximates
  hardware LFO variation without touching the shared oscillator's rate.

Both are per-voice `Tone.Gain` nodes, disposed with the rest of that
voice's mod-matrix nodes.

## Canvas

Revised from the first pass of this feature: sources/destinations are a
known, fixed *catalog* (unlike FX's free-form node graph, where the
algorithms themselves are the free-form part), but node **presence** on
the canvas is opt-in, not pre-populated — the canvas starts empty and the
user adds a Source or Destination node via an "Add Source…"/
"Add Destination…" combo, the exact same interaction shape as
`FxChainEditor.vue`'s "Add node" combo. `Preset.modulationNodes: {
sources: string[]; destinations: string[] }` is the authoritative list of
what's actually placed. Removing a node (✕ button) cascades to delete any
`modMatrix` cables that referenced it, same as `FxChainEditor.removeNode()`
— a node is never left with dangling cables. A preset saved before this
existed is lazily migrated by seeding `modulationNodes` from whatever its
`modMatrix` cables already reference, so already-built routings never
lose their visible nodes.

Every node is **draggable**: `Preset.modulationLayout` persists each
node's canvas position (keyed by id — `patchLfo1`, `pitchWheel`,
`filterFreq`, a custom source's id, …), reusing `FxChainEditor.vue`'s
existing node-drag mechanics (`startPositionDrag`). Custom MIDI sources
are the one source type with no placement cap — each "Add Source" →
"Custom MIDI Source…" creates a new named node; every other catalog entry
can only be placed once (the combo hides an entry once it's on the
canvas).

LFO nodes (`patchLfo1`/`patchLfo2`) additionally get FX-node-style chrome
(`LfoEditor.vue`'s `patchMode` prop), mirroring `FxChainEditor.vue`'s FX
nodes exactly:
- **Collapsible, default collapsed** — a chevron toggles the Rate/Delay/
  Variation/Shape controls; collapse state is local component display
  state, not persisted (same as `FxChainEditor`'s `expandedNodes`).
- **Bypassable** (`Lfo.bypass`, a Power-icon toggle) — unlike collapse,
  this *is* persisted data: a bypassed LFO contributes no modulation at
  all, checked in `modMatrix.ts` right where a routing's source resolves
  to `patchLfo1`/`patchLfo2`. Silent, not a warning — a bypassed cable is
  valid and temporarily inactive, not unresolvable.

All Modulation canvas nodes use the `.sd-node-mod` CSS class (parallel to
FX's `.sd-node`), distinct from the plain `.sd-panel` class used for
non-canvas UI chrome elsewhere in Sound Design/Performance mode.

## Preset library, persistence

Unchanged from `FX-Modulations.md`: `useFxModLibrary.ts`/
`FxModPresetStore.ts` save/load named modulation patches
(`{ slots, lfo1, lfo2 }`); Sound Design autosaves, Performance mode saves
only on explicit Save. None of this revision's new fields
(`rateMode`/`syncDivision`, `customMidiSources`, `modulationLayout`, the
new destination ids) required any change to that mechanism — all
optional/additive, read defensively wherever consumed.

## Sound Design Layers Modulations

Per-layer modulation (`Layer.modMatrix`, `ModMatrixEditor.vue`) is
explicitly out of scope for this revision — untouched, still available
for legacy/imported hardware data, gated behind `Preset.modMatrixBypassed`
(default bypassed) since raw E4B-imported layer routings were found to
audibly degrade playback if applied unconditionally. May be revisited
later.
