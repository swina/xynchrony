<script setup lang="ts">
// Hidden/skipped automatically when only one bank exists (per
// docs/ARCHITECTURE.md §1.5) -- the parent (App.vue) already handles that
// by not rendering this component in the single-bank case, so this stays
// a plain dropdown. Groups static (built-in) vs. user (Sound Design)
// banks -- see approved plan Part 3 / M11.
import { computed } from 'vue'
import type { BankManifestEntry } from '../core/audio/types'

const props = defineProps<{ banks: BankManifestEntry[]; activeBankId: string | null }>()
const emit = defineEmits<{ select: [bankId: string] }>()

const staticBanks = computed(() => props.banks.filter((b) => b.source !== 'user'))
const userBanks = computed(() => props.banks.filter((b) => b.source === 'user'))
</script>

<template>
  <select
    :value="activeBankId"
    class="sd-input rounded-lg px-3 py-2 text-sm"
    @change="emit('select', ($event.target as HTMLSelectElement).value)"
  >
    <optgroup label="Built-in">
      <option v-for="b in staticBanks" :key="b.id" :value="b.id">{{ b.name }} ({{ b.presetCount }})</option>
    </optgroup>
    <optgroup v-if="userBanks.length" label="My Banks">
      <option v-for="b in userBanks" :key="b.id" :value="b.id">{{ b.name }} ({{ b.presetCount }})</option>
    </optgroup>
  </select>
</template>
