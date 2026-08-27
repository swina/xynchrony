/** Deep-clones into a fully plain (non-reactive) object graph. Plain
 * `toRaw()` only strips the Vue Proxy off its immediate argument, not any
 * reactive objects/arrays nested inside it, and `structuredClone` can't
 * clone a Proxy directly (`DataCloneError`) -- this shows up any time data
 * pulled from a `ref`/`reactive` (a freshly-built wrapper literal around
 * still-reactive nested values, or an element read out of a reactive
 * array/object) gets handed to `structuredClone` or IndexedDB. JSON
 * round-tripping reads straight through any nesting of Proxies (property
 * access just triggers their get traps) and only needs the value to be
 * plain JSON-safe data (numbers/strings/booleans/plain objects/arrays, no
 * Dates/Maps/functions/undefined-preserving needs) -- true for every data
 * shape this app persists (Bank/Preset, FxChain, ModulationPreset). */
export function deepClonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
