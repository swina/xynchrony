<script setup lang="ts">
// On-screen piano. Calls the exact same AudioEngine.noteOn/noteOff as
// MIDI input (via useAudioEngine) -- one trigger path regardless of input
// source, per docs/ARCHITECTURE.md §4. Lights up on incoming MIDI notes
// too, since heldNotes is shared engine state, not local-only.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAudioEngine } from '../composables/useAudioEngine'
import { noteName, isBlackKey } from '../utils/noteNames'
import { ChevronLeft, ChevronRight } from '@lucide/vue'

const { heldNotes, noteOn, noteOff, ensureStarted } = useAudioEngine()

const octaveStart = ref(48) // C2, per E-mu convention (C3 = 60)
const octaveCount = 3
const velocity = 100

const notes = computed(() => {
  const list: number[] = []
  for (let i = 0; i < octaveCount * 12 + 1; i++) list.push(octaveStart.value + i)
  return list
})

const localHeld = ref(new Set<number>())

function isHeld(note: number): boolean {
  return localHeld.value.has(note) || heldNotes.value.includes(note)
}

async function press(note: number) {
  await ensureStarted()
  localHeld.value.add(note)
  noteOn(note, velocity)
}

function releaseNote(note: number) {
  if (!localHeld.value.has(note)) return
  localHeld.value.delete(note)
  noteOff(note)
}

function releaseAllLocal() {
  for (const note of [...localHeld.value]) releaseNote(note)
}

function shiftOctave(delta: number) {
  const next = octaveStart.value + delta * 12
  if (next >= 0 && next + octaveCount * 12 <= 127) octaveStart.value = next
}

// A container-level @mouseleave used to blanket-release every held note --
// fragile, since any layout shift from a key's own pressed-state styling
// (or the cursor drifting a pixel during a hold) fires it mid-note. A
// window-level mouseup is the standard, robust way to catch "released
// outside the element the press started on" -- release only happens on
// an actual button-up, never from the pointer merely leaving a container.
onMounted(() => window.addEventListener('mouseup', releaseAllLocal))
onUnmounted(() => window.removeEventListener('mouseup', releaseAllLocal))
</script>

<template>
  <div class="flex flex-col items-center gap-2 select-none">
    <div class="flex items-center gap-3 text-sm" style="color: var(--color-ink-soft)">
      <button class="sd-btn inline-flex items-center gap-1" @click="shiftOctave(-1)"><ChevronLeft :size="14" /> octave</button>
      <span>{{ noteName(octaveStart) }} &ndash; {{ noteName(octaveStart + octaveCount * 12) }}</span>
      <button class="sd-btn inline-flex items-center gap-1" @click="shiftOctave(1)">octave <ChevronRight :size="14" /></button>
    </div>

    <div
      class="relative flex h-32 select-none"
      @touchend.prevent="releaseAllLocal"
      style="touch-action: none"
    >
      <template v-for="note in notes" :key="note">
        <button
          v-if="!isBlackKey(note)"
          class="relative w-8 h-full rounded-b-md"
          :style="{
            border: '1px solid var(--color-ink)',
            backgroundColor: isHeld(note) ? 'var(--color-skyblue)' : 'var(--color-cream)',
          }"
          @mousedown="press(note)"
          @mouseup="releaseNote(note)"
          @touchstart.prevent="press(note)"
          @touchend.prevent="releaseNote(note)"
        />
      </template>

      <div class="absolute inset-0 flex pointer-events-none">
        <template v-for="note in notes" :key="'gap-' + note">
          <div v-if="!isBlackKey(note)" class="relative w-8 h-full">
            <button
              v-if="isBlackKey(note + 1) && notes.includes(note + 1)"
              class="absolute left-[22px] top-0 w-5 h-20 rounded-b-md z-10 pointer-events-auto"
              :style="{ backgroundColor: isHeld(note + 1) ? 'var(--color-primary)' : 'var(--color-ink)' }"
              @mousedown="press(note + 1)"
              @mouseup="releaseNote(note + 1)"
              @touchstart.prevent="press(note + 1)"
              @touchend.prevent="releaseNote(note + 1)"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
