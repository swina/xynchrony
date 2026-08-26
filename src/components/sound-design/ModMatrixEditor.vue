<script setup lang="ts">
// 20-slot mod matrix editor. Source/destination dropdowns are seeded from
// the same enum tables the Python parser and modMatrix.ts routing table
// use (src/data/modMatrixEnums.ts), so values entered here round-trip
// through the exact same "raw:0xNN" fallback as real bank data -- see
// approved plan Part 2 / M10. Amount dials learn by slot *position*
// (sd:modmatrix:slot:N) rather than by (source,destination), since a
// physical knob bound to "the 3rd routing" is the useful hardware-MIDI-Learn
// behavior even as the routing in that slot changes.
import { computed } from 'vue'
import { KNOWN_MOD_SOURCES, KNOWN_MOD_DESTINATIONS } from '../../data/modMatrixEnums'
import type { Layer, ModMatrixSlot } from '../../core/audio/types'
import Dial from './Dial.vue'
import { Plus, X } from '@lucide/vue'

const props = defineProps<{ layer: Layer }>()

const MAX_SLOTS = 20

function optionsFor(known: readonly string[], current: string): string[] {
  return known.includes(current) ? [...known] : [...known, current]
}

function sourceOptions(slot: ModMatrixSlot): string[] {
  return optionsFor(KNOWN_MOD_SOURCES, slot.source)
}
function destOptions(slot: ModMatrixSlot): string[] {
  return optionsFor(KNOWN_MOD_DESTINATIONS, slot.destination)
}

const canAdd = computed(() => props.layer.modMatrix.length < MAX_SLOTS)

function addSlot() {
  if (!canAdd.value) return
  props.layer.modMatrix.push({ source: KNOWN_MOD_SOURCES[0], destination: KNOWN_MOD_DESTINATIONS[0], amountPct: 0, flag: 0, midiCC: null })
}

function onCcInput(slot: ModMatrixSlot, raw: string) {
  if (raw === '') { slot.midiCC = null; return }
  const n = Math.min(127, Math.max(0, Math.round(Number(raw))))
  slot.midiCC = Number.isNaN(n) ? null : n
}

function removeSlot(i: number) {
  props.layer.modMatrix.splice(i, 1)
}

const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}%`
</script>

<template>
  <div class="sd-panel flex flex-col gap-2 w-80 shrink-0">
    <div class="flex items-center justify-between">
      <h4 class="sd-panel-title">Mod Matrix ({{ layer.modMatrix.length }}/{{ MAX_SLOTS }})</h4>
      <button class="sd-btn inline-flex items-center gap-1" :disabled="!canAdd" @click="addSlot"><Plus :size="14" /> Add</button>
    </div>

    <div class="flex flex-col gap-2 max-h-96 overflow-y-auto sd-scroll">
      <div v-for="(slot, i) in layer.modMatrix" :key="i" class="flex flex-col gap-1 pb-2" :class="i > 0 ? 'border-t pt-2' : ''" style="border-color: var(--color-mocha)">
        <div class="grid grid-cols-2 gap-2">
          <select v-model="slot.source" class="sd-input text-xs" :disabled="slot.midiCC !== null">
            <option v-for="s in sourceOptions(slot)" :key="s" :value="s">{{ s }}</option>
          </select>
          <select v-model="slot.destination" class="sd-input text-xs">
            <option v-for="d in destOptions(slot)" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-1 text-xs shrink-0" title="Custom MIDI CC -- overrides the Source dropdown when set">
            CC
            <input
              type="number" min="0" max="127"
              :value="slot.midiCC ?? ''"
              placeholder="&mdash;"
              class="sd-input text-xs w-14"
              @input="onCcInput(slot, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <div class="flex-1"></div>
          <Dial v-model="slot.amountPct" :min="-100" :max="100" :size="36" :learn-id="`sd:modmatrix:slot:${i}`" :format-value="fmtPct" />
          <button class="sd-btn sd-btn-icon sd-btn-danger" title="Remove" @click="removeSlot(i)"><X :size="14" /></button>
        </div>
      </div>
      <div v-if="layer.modMatrix.length === 0" class="px-1 py-3 text-xs text-center" style="color: var(--color-ink-soft)">
        No routings yet.
      </div>
    </div>
  </div>
</template>
