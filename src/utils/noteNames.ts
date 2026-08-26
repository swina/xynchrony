// E-mu octave convention confirmed in docs/ARCHITECTURE.md: C3 = MIDI 60.
const NOTE_LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function noteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 2 // MIDI 60 -> "C3"
  return `${NOTE_LETTERS[midi % 12]}${octave}`
}

export function isBlackKey(midi: number): boolean {
  return NOTE_LETTERS[midi % 12].includes('#')
}
