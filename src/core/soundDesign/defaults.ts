// Factory functions for blank Layer/Zone/Envelope/Lfo objects used when
// the Sound Design editor creates new structure from scratch (as opposed
// to duplicating existing data). Defaults aim for "audible and inoffensive
// out of the box": instant attack, full sustain, a short release so
// nothing clicks, no filter resonance, full-range key/velocity.
import type { Layer, Zone, Envelope, AuxEnvelope, Lfo, FilterParams, LayerGroup, Glide, Latch } from '../audio/types'

// Wide-open lowpass = inaudible effect until the user dials it in via the
// Filter tab. Every Sound Design-created/duplicated preset gets this (see
// UserBankStore.ts) rather than any filter data inherited from Orbit-3 --
// that data is per-layer, unvalidated, and was the whole reason filter
// playback used to be bypassed entirely (docs/ARCHITECTURE.md).
export function blankFilter(): FilterParams {
  return { typeRaw: 0, typeEstimated: 'lowpass', cutoffRaw: 255, cutoffHzEstimated: 20000, resonance: 0 }
}

export function blankEnvelope(): Envelope {
  return {
    attack1Rate: 0, attack1Level: 127,
    attack2Rate: 0, attack2Level: 127,
    decay1Rate: 0, sustainLevel: 127,
    decay2Rate: 0, decay2Level: 127,
    release1Rate: 20, release1Level: 0,
    release2Rate: 0, release2Level: 0,
    modeMarker: '0000',
  }
}

export function blankAuxEnvelope(): AuxEnvelope {
  return { ...blankEnvelope(), _rawStageOrder: 'A1,D1,R1,A2,D2,R2 (as stored on disk; other fields here are already remapped)' }
}

export function blankLfo(): Lfo {
  return { rate: 64, shape: 'sine', delay: 0, variation: 0, sync: 'freeRun' }
}

export function blankGlide(): Glide {
  return { enabled: false, curve: 'linear', rate: 64 }
}

export function blankLatch(): Latch {
  return { enabled: false, maxNotes: 4 }
}

// New group starts as a copy of blankEnvelope()/blankAuxEnvelope(), not
// linked to any layer's existing envelope data -- joining it is an
// explicit per-layer choice (EnvelopeScopeEditor.vue), never automatic.
export function blankLayerGroup(name: string): LayerGroup {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `group-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    ampEnv: blankEnvelope(),
    auxEnv: blankAuxEnvelope(),
  }
}

export function blankLayer(layerIndex: number): Layer {
  return {
    layerIndex,
    params: {
      delayMs: 0, transposeSemitones: 0, fineTuneCents: 0, nonTranspose: false,
      volumeDb: 0, pan: 0,
    },
    ampEnv: blankEnvelope(),
    auxEnv: blankAuxEnvelope(),
    lfo1: blankLfo(),
    lfo2: blankLfo(),
    modMatrix: [],
    zones: [],
  }
}

export function blankZone(): Zone {
  return {
    sampleIndex: 0, sampleName: null, sampleRate: null, wavFile: null,
    rootKey: 60, loKey: 0, hiKey: 127, loVel: 0, hiVel: 127, fineTune: 0,
    volumeDb: null, pan: null, loopStart: 0, loopEnd: 0, isLooping: false,
  }
}
