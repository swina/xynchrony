/** `crypto.randomUUID()` with a fallback for contexts that lack it
 * (matches the same inline pattern already used in UserBankStore.ts /
 * core/soundDesign/defaults.ts -- centralized here for new call sites so a
 * third copy-paste isn't added). */
export function newId(prefix = 'id'): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
