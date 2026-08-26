<script setup lang="ts">
// Mini keyboard for assigning a zone's key range by clicking/dragging
// notes, per docs/plans/sound-design-ui.md ("Zone Assignment ... a full
// mini keyboard where the user can assign the zone range clicking on the
// corresponding note (show the current settings also in the mini
// keyboard)"). A dedicated component rather than reusing
// VirtualKeyboard.vue -- that one's press-to-play semantics don't fit this
// drag-to-select-a-range interaction. Mutates the selected zone's
// loKey/hiKey directly (same direct-prop-mutation pattern as
// EnvelopeDesigner.vue) since `zones` is the same reactive array
// useUserBanks holds -- no emit needed.
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import type { Zone } from '../../core/audio/types'
import { noteName, isBlackKey } from '../../utils/noteNames'

const props = defineProps<{ zones: Zone[]; activeZoneIndex: number | null }>()

const KEY_W = 14 // white key width, px
const BLACK_KEY_W = 9

const notes = computed(() => {
  const list: number[] = []
  for (let i = 0; i <= 127; i++) list.push(i)
  return list
})
const whiteNotes = computed(() => notes.value.filter((n) => !isBlackKey(n)))

const activeZone = computed(() => {
  if (props.activeZoneIndex === null) return null
  return props.zones[props.activeZoneIndex] ?? null
})

function otherZoneRanges(): Array<{ loKey: number; hiKey: number }> {
  return props.zones
    .filter((_, i) => i !== props.activeZoneIndex)
    .map((z) => ({ loKey: z.loKey, hiKey: z.hiKey }))
}

function inActiveRange(note: number): boolean {
  const z = activeZone.value
  return !!z && note >= z.loKey && note <= z.hiKey
}

function inOtherRange(note: number): boolean {
  return otherZoneRanges().some((r) => note >= r.loKey && note <= r.hiKey)
}

const dragging = ref(false)
const anchorNote = ref<number | null>(null)

function applyRange(a: number, b: number) {
  const z = activeZone.value
  if (!z) return
  z.loKey = Math.min(a, b)
  z.hiKey = Math.max(a, b)
}

function onPointerDown(note: number) {
  if (!activeZone.value) return
  dragging.value = true
  anchorNote.value = note
  applyRange(note, note)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerEnter(note: number) {
  if (!dragging.value || anchorNote.value === null) return
  applyRange(anchorNote.value, note)
}

function onPointerUp() {
  dragging.value = false
  anchorNote.value = null
  window.removeEventListener('pointerup', onPointerUp)
}

const scrollEl = ref<HTMLElement | null>(null)

function scrollToActiveRange() {
  const z = activeZone.value
  const el = scrollEl.value
  if (!z || !el) return
  const whiteIndexBefore = whiteNotes.value.filter((n) => n < z.loKey).length
  el.scrollTo({ left: Math.max(0, whiteIndexBefore * KEY_W - el.clientWidth / 2), behavior: 'smooth' })
}

onMounted(() => nextTick(scrollToActiveRange))
watch(() => props.activeZoneIndex, () => nextTick(scrollToActiveRange))
</script>

<template>
  <div ref="scrollEl" class="w-full overflow-x-auto sd-scroll select-none" style="touch-action: none">
    <div class="relative flex h-14" :style="{ width: whiteNotes.length * KEY_W + 'px' }">
      <template v-for="note in whiteNotes" :key="note">
        <div
          class="relative h-full shrink-0 rounded-b-sm"
          :style="{
            width: KEY_W + 'px',
            border: '1px solid var(--color-mocha)',
            backgroundColor: inActiveRange(note)
              ? 'var(--color-skyblue)'
              : inOtherRange(note)
                ? 'color-mix(in srgb, var(--color-mocha) 55%, transparent)'
                : 'var(--color-cream)',
            cursor: activeZone ? 'pointer' : 'default',
          }"
          :title="noteName(note)"
          @pointerdown="onPointerDown(note)"
          @pointerenter="onPointerEnter(note)"
        />
      </template>

      <div class="absolute inset-0 flex pointer-events-none">
        <template v-for="note in whiteNotes" :key="'gap-' + note">
          <div class="relative shrink-0 h-full" :style="{ width: KEY_W + 'px' }">
            <div
              v-if="isBlackKey(note + 1) && notes.includes(note + 1)"
              class="absolute top-0 rounded-b-sm z-10 pointer-events-auto"
              :style="{
                left: (KEY_W - BLACK_KEY_W / 2) + 'px',
                width: BLACK_KEY_W + 'px',
                height: '60%',
                backgroundColor: inActiveRange(note + 1)
                  ? 'var(--color-primary)'
                  : inOtherRange(note + 1)
                    ? 'var(--color-ink-soft)'
                    : 'var(--color-ink)',
                cursor: activeZone ? 'pointer' : 'default',
              }"
              :title="noteName(note + 1)"
              @pointerdown.stop="onPointerDown(note + 1)"
              @pointerenter="onPointerEnter(note + 1)"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
