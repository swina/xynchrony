# FX & MODULATION

Performance Mode becomes a Sound-Design-style three-pane workarea (Presets /
FX / Modulation), FX gets per-node Wet/Dry, Modulation becomes a real
patch-level feature (not just a plan — an implemented one), and both FX and
Modulation get a visual, drag-and-cable patching editor instead of
dropdown-based routing — with the resulting chains savable as a reusable
preset library, independent of any one Bank/Preset. See `sound-design-ui.md`
for the three-pane precedent and `docs/ARCHITECTURE.md` §3 ("Effects") for
the current FX implementation this revises.

## Decisions (locked)

Resolves the two open questions from the previous revision of this doc:

1. **Modulation scope: Option B — patch-level.** `Preset.modMatrix?:
   ModMatrixSlot[]`, applied identically across every layer of the preset,
   alongside (not replacing) each layer's own `modMatrix` which Sound
   Design's per-layer `ModMatrixEditor.vue` keeps editing unchanged. Same
   precedent as Filter and Preset FX already moving from per-layer to
   patch-level (`ARCHITECTURE.md` §3) — performance-relevant control lives
   at the patch, layer-level detail stays in Sound Design.
2. **Persistence: session-only unless explicitly Saved.** Performance mode's
   FX/Modulation panes never autosave. A live tweak while playing is
   transient — reverts to the loaded preset's last-saved state on reload or
   on switching away and back — until the performer presses **Save**, which
   writes the current in-memory `fx`/`modMatrix`/patch-level-LFO state back
   into the active user bank (see "Persistence" below). This is deliberately
   the opposite of Sound Design mode's existing debounced autosave
   (`persistActiveBank`, `SoundDesignView.vue`) — Performance mode's purpose
   is playing, so an accidental live tweak mid-performance must never
   silently overwrite a saved patch.

## Performance Mode layout

Replaces the current single-column Performance view (`PerformanceView.vue`:
`PresetBrowser` → `VirtualKeyboard` → `VoiceActivityView`, stacked) with a
three-pane workarea, same shape as Sound Design's:

```
Left Pane:   Presets List        (PresetBrowser.vue, unchanged)
Center Pane: FX                  (this preset's Preset FX patch editor)
Right Pane:  Modulation          (this preset's Modulation patch editor)

Below all three, full width: VoiceActivityView + VirtualKeyboard (unchanged)
```

- **Global FX** (master bus, every preset) stays where it is today — the
  popover in `TopBar.vue`, shared by both modes. It's app-wide config, not
  preset data (`useGlobalFx.ts`), so it doesn't belong in either pane, but it
  reuses the same patch-editor component as the Center Pane (same
  `EffectChainConfig`-descended shape — see below).
- **Preset FX** moves from the TopBar popover just added for Performance
  mode into the permanent Center Pane instead. Remove that popover once the
  Center Pane ships — same data (`currentPreset.fx`), no reason to keep both.

## Visual patch editor

Both FX and Modulation move to a shared drag-and-cable interaction model —
draggable node/jack "modules" on a canvas, connected by cables you drag from
one jack to another — instead of the algorithm-dropdown / layer-scoped
Mod Matrix table editors. Same visual language, two different graphs:

- **FX** is a *free-form* graph: the user creates, deletes, moves, and wires
  effect nodes in any order/shape they want (including parallel branches —
  see below). This is also a real capability upgrade, not just a reskin: it
  replaces the fixed "Slot A → Slot B in series" limit (`ARCHITECTURE.md`
  §3's "not the full per-voice Main/Aux1-3 send architecture" simplification)
  with an arbitrarily-sized chain, closer to what real Emulator X3's fuller
  send architecture allowed.
- **Modulation** is a *fixed jack panel*: sources and destinations are a
  known, non-creatable catalog (the same catalog `modMatrix.ts` already
  routes) laid out in two columns: draggable **cables** between them are the
  only thing the user creates or deletes.

No new npm dependency for the canvas — plain SVG (`<path>` bezier per cable)
over absolutely-positioned Vue/Tailwind DOM nodes, matching this codebase's
existing hand-rolled-over-library approach elsewhere (Tone.js used as a raw
DSP toolkit rather than `Tone.Sampler`, no charting/graph library anywhere
else in `src/`).

### FX Chain patching

**Data model** (`core/audio/types.ts`) — replaces the fixed `slotA`/`slotB`
shape from the previous revision of this doc:

```ts
export interface FxNode {
  id: string
  algorithm: EffectAlgorithm     // no 'off' anymore -- delete the node instead
  params: Record<string, number>
  wetDry: number                 // 0-100, this node's own mix (kept from the
                                  // per-node Wet/Dry decision, generalized
                                  // from "per-slot" to "per-node")
  position: { x: number; y: number } // canvas layout, persisted so a saved
                                      // patch looks the same next time
}

export interface FxEdge {
  id: string
  from: string // FxNode id, or the literal 'input'
  to: string   // FxNode id, or the literal 'output'
}

export interface FxChain {
  nodes: FxNode[]
  edges: FxEdge[]
  wetDry: number // 0-100, overall chain mix: dry input vs. the summed
                 // output-bus signal (kept from today's chain-level mix,
                 // unaffected by per-node mixing -- see signal flow below)
}
```

`Preset.fx` and `useGlobalFx.ts`'s config both become `FxChain` instead of
today's `EffectChainConfig`.

**Signal flow** (`core/audio/effects.ts`'s `EffectChain`): each node gets its
own dry/wet mix stage (unchanged from the per-slot Wet/Dry decision, just
generalized to N nodes instead of exactly 2):

```
stageIn -> [node's own dry tap] -> nodeCrossFade.a
stageIn -> [node's own wet tap] -> node's Tone node -> nodeCrossFade.b
nodeCrossFade.fade = node.wetDry/100 -> stageOut
```

Wiring `stageIn`/`stageOut` per node from `FxEdge[]`: a node with multiple
incoming edges sums them (plain multiple `.connect()` calls into the same
Tone input — Web Audio auto-sums); a node with multiple outgoing edges fans
out (multiple `.connect()` calls from the same output, each destination gets
the full signal, same as any other Web Audio fan-out) — this is what makes
parallel branches ("split into a Chorus branch and a Reverb branch, sum both
into Output") possible. `'input'`/`'output'` are pseudo-nodes: `'input'` is
the chain's existing wet tap, `'output'` feeds the chain's existing overall
`crossFade.b` — the outer dry/wet mix (`FxChain.wetDry`) and the Mod Matrix's
`wetDryMix` destination (`EffectChain.wetDryFade`) are both unaffected by
this change, same as the previous revision already established.

**Constraints (v1)**: reject cycles at edge-creation time (a feedback loop
needs real audio-rate feedback design — Tone.js can do it, but it's a
distinct feature, not "drag a cable," and changes the dry/wet-per-node math
above). Cap node count generously (e.g. 12) to keep the canvas and the audio
graph sane — no hardware precedent to match here since this is already past
what real Emulator X3's 2-slot Preset FX allowed.

**Migration**: existing saved presets with the old `{slotA, slotB, wetDry}`
shape convert on load into a 2-node straight-line graph (`input -> slotA ->
slotB -> output`, default positions left-to-right) — same sound, no data
loss, just represented as a graph from then on.

### Modulation patching

**Fixed jacks**, laid out in two columns:

- **Sources** (right-hand output jack each): `pitchWheel`, `key`, `gate`,
  `pressure`, `velocity` (today's live/one-time sources, `ARCHITECTURE.md`
  §3) as plain label+jack modules (no params), plus **`lfo1`/`lfo2`** as
  *parametered* modules — small boxes with their own Rate/Delay/Variation
  dials directly on the node body (like a real modular LFO module), and an
  output jack other cables patch from. These are the patch-level LFO pair
  from Decision 1, independent of any layer's own `lfo1`/`lfo2`.
- **Destinations** (left-hand input jack each): the known catalog
  `modMatrix.ts` already supports (`pitch`, `filterFreq`, `filterQ`,
  `wetDryMix`, `lfo1Rate`, `lfo2Rate`, …) as label+jack modules.
- A **cable** = one `ModMatrixSlot` (source, destination, `amountPct`,
  optional `midiCC` override). Clicking a cable reveals an inline Amount
  dial (same `-100..100%` range `ModMatrixEditor.vue` uses today) and the
  existing CC-override numeric input, so a cable's amount doesn't need a
  separate always-visible dial cluttering the canvas. Multiple cables may
  land on the same destination jack (already legal today — multiple slots
  can already target one destination); multiple cables may leave the same
  source jack (one source feeding several destinations, already legal too).
- Sources/destinations are fixed and always present (not draggable off the
  canvas, not deletable) — only the cables between them are user-created
  content, and only cables are what gets saved.

## FX / Modulation preset library

Chains built in either patch editor can be saved as a **named, reusable
preset**, independent of any Bank/Preset, then recalled and applied to
*any* patch later:

- **Storage**: a new `FxModPresetStore.ts`, mirroring `UserBankStore.ts`'s
  existing IndexedDB pattern (named entries, list/create/rename/delete) — a
  closer fit than a single `localStorage` blob (`useGlobalFx.ts`'s pattern)
  now that a library can hold many hand-built chains over time, not one
  always-on app-wide config. One object store, entries shaped
  `{ id, name, kind: 'fx' | 'modulation', createdAt, data: FxChain |
  ModulationPreset }` where `ModulationPreset` is `{ slots: ModMatrixSlot[];
  lfo1: Lfo; lfo2: Lfo }` (the patch-level cables plus the two LFO modules'
  settings, since those are part of what a saved modulation patch means).
- **UI**: a small library panel attached to each patch editor (Center Pane
  for FX, Right Pane for Modulation; Global FX's TopBar popover gets the FX
  one too) — "Save as…" (name + store the current graph), a list to pick
  from, "Apply" and "Delete". Same shape as `BankManagerPanel.vue` /
  `PresetListPanel.vue`'s existing list-with-actions pattern in Sound
  Design, reused rather than invented fresh.
- **Apply semantics**: clicking Apply **deep-clones** (`structuredClone`,
  same defensive copy `UserBankStore.duplicatePresetInto()` already uses)
  the library entry's `data` into `currentPreset.fx` /
  `currentPreset.modMatrix`+LFOs — never binds the live preset to the same
  object the library entry owns, so editing the patch afterward can't mutate
  the saved library preset out from under it, and deleting a library entry
  later can't orphan a patch that applied it.

## Persistence

Two independent save actions, both explicit, neither automatic in
Performance mode:

1. **Save (patch)** — Center/Right pane header button, writes the current
   in-memory `fx`/`modMatrix`/patch-level-LFO state back onto
   `currentPreset` *and* persists the owning user bank (same underlying
   write `SoundDesignView.vue`'s `persistActiveBank` does, called
   explicitly here instead of on a debounce timer). Only enabled when the
   active bank is user-owned (`BankManifestEntry.source === 'user'`) — static
   banks (Orbit-3) have nowhere to persist to, so the button is disabled
   with a tooltip explaining why, same as their `fx`/`modMatrix` already
   being lazily-seeded, inherently-non-persistent scratch data today.
2. **Save as… (library)** — inside the preset-library panel, always
   available regardless of which bank is loaded (a library entry isn't tied
   to a specific patch or bank at all) — writes to `FxModPresetStore`, not to
   the loaded bank.

Sound Design mode's existing autosave-on-edit behavior for `fx` (and, once
built, patch-level `modMatrix`) is unchanged — Decision 2 only changes
Performance mode's behavior.

## Remaining open questions

1. Canvas pan/zoom: nice-to-have for FX once chains grow past a handful of
   nodes; not required for v1 (a fixed-size scrollable canvas is enough to
   start).
2. Whether `Voice.ts`/`applyModMatrix` should special-case "patch-level slot
   + this layer's own slot both target the same destination" (sum, like two
   layer-level slots already do) or something else — default assumption is
   plain summation, consistent with how multiple slots already combine.
3. Whether the FX node palette (Center Pane's "Add node" control) should be
   allowed to add more than one instance of the same algorithm (e.g. two
   parallel `reverb` nodes) — default assumption is yes, nothing in the data
   model above prevents it, and it's a natural use of the new free-form graph.
