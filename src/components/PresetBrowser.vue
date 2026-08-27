<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Bank } from '../core/audio/types'

const props = defineProps<{ bank: Bank; activeBankProg: string | null }>()
const emit = defineEmits<{ select: [bankProg: string] }>()

const search = ref('')
const categoryFilter = ref<string>('All')

const categories = computed(() => {
  const set = new Set<string>()
  for (const p of Object.values(props.bank.presets)) {
    if (p.category) set.add(p.category)
  }
  return ['All', ...[...set].sort()]
})

const entries = computed(() => {
  const q = search.value.trim().toLowerCase()
  return Object.entries(props.bank.presets)
    .filter(([, p]) => categoryFilter.value === 'All' || p.category === categoryFilter.value)
    .filter(([, p]) => !q || p.name.toLowerCase().includes(q))
    .sort(([a], [b]) => a.localeCompare(b))
})
</script>

<template>
  <div class="flex flex-col gap-3 w-full max-w-2xl">
    <div class="flex gap-2">
      <input
        v-model="search"
        type="text"
        placeholder="Search presets&hellip;"
        class="sd-input flex-1 rounded-lg px-3 py-2 text-sm"
      />
      <select
        v-model="categoryFilter"
        class="sd-input rounded-lg px-3 py-2 text-sm"
      >
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
    </div>

    <div class="text-xs" style="color: var(--color-ink-soft)">{{ entries.length }} preset{{ entries.length === 1 ? '' : 's' }}</div>

    <div class="h-72 overflow-y-auto sd-scroll rounded-lg border sd-divide" style="border-color: var(--color-mocha)">
      <button
        v-for="[bankProg, preset] in entries"
        :key="bankProg"
        class="sd-row w-full text-xs text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors"
        :class="bankProg === activeBankProg ? 'sd-row-active' : ''"
        @click="emit('select', bankProg)"
      >
        <span class="truncate">{{ preset.name }}</span>
        <span class="text-xs shrink-0" style="color: var(--color-ink-soft)">{{ bankProg }}<span v-if="preset.category"> &middot; {{ preset.category }}</span></span>
      </button>
    </div>
  </div>
</template>
