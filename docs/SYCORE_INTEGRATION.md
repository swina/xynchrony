# Using Xynchrony as a Virtual Instrument in sycore

Xynchrony runs as its own standalone app — it does not need to be embedded
into or built as part of `sycore-refactor`. sycore's own "Virtual
Instrument" concept (`src/types/midi.ts`, `src/stores/useMidiStore.ts` in
that project) is explicitly designed for exactly this: an external,
standalone synth reached through a real OS-level virtual MIDI cable, not an
in-process embedding. No code changes are needed in either project — this
is a one-time setup on your machine.

## 1. Install a virtual MIDI loopback port

Pick one, matching your OS:

- **Windows**: [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) — create a port (e.g. named `Xynchrony`).
- **macOS**: the built-in **IAC Driver** — open *Audio MIDI Setup* → *MIDI Studio* → double-click *IAC Driver* → enable "Device is online", add a port if needed.
- **Linux**: `snd-virmidi` (ALSA) or `a2jmidid` (JACK) — either exposes a virtual port other apps can see.

## 2. Register Xynchrony as a Virtual Instrument in sycore

In sycore's MIDI Flow canvas, add a Virtual Instrument (`useMidiStore`'s
`addVirtualInstrument(name, midiOutputPort)`) and bind its `midiOutputPort`
to the loopback port you created above. This is what sycore sends MIDI
*out* through when you route anything (a sequencer, the drum machine, a
real keyboard) to that Virtual Instrument on the canvas.

## 3. Point Xynchrony's MIDI input at the same port

Open Xynchrony, click **Enable audio**, then in the Transport Bar's MIDI
device selector pick the *same* loopback port. From here on, anything
sycore routes to that Virtual Instrument plays through Xynchrony's actual
Orbit-3 (or your own Sound Design) voices, live, in a completely separate
tab/process — both apps keep their independent Web MIDI connections to the
same OS-level port.

## Notes

- sycore's own "online" flag for a Virtual Instrument (see the comment in
  `src/types/midi.ts`) is manual, precisely because sycore has no way to
  detect whether the standalone app on the other end is actually running —
  set it yourself from sycore's MIDI Flow card once Xynchrony is open.
- This setup works identically whether Xynchrony is playing the built-in
  Orbit-3 bank or a bank you've created in Sound Design mode — from
  sycore's side, it's just MIDI in, audio out, same as any other synth on
  the canvas.
- sycore's separate, existing "Emulator X3 import" feature
  (`src/composables/useEmulatorX3Parser.js`) is unrelated to this — it's a
  flat preset-name-list importer for sycore's own Program Change browser
  (used for sending Program Change to real hardware), not a link to this
  app.
