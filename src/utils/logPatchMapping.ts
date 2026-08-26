// Prints exactly what a preset's zones/key-ranges resolved to -- the
// direct answer to "is the data actually what I think it is", without
// needing to trigger a note or dig through the Network tab. Shared by
// TopBar.vue (on bank switch) and PerformanceView.vue (on preset select).
import type { Bank } from '../core/audio/types'

export function logPatchMapping(bank: Bank, bankProg: string): void {
  const preset = bank.presets[bankProg]
  if (!preset) return
  const rows = preset.layers.flatMap((layer) =>
    layer.zones.map((z) => ({
      layer: layer.layerIndex,
      sample: z.sampleName,
      wavFile: z.wavFile,
      root: z.rootKey,
      loKey: z.loKey,
      hiKey: z.hiKey,
      loVel: z.loVel,
      hiVel: z.hiVel,
    })),
  )
  console.groupCollapsed(`[patch] ${bankProg} "${preset.name}" (${preset.category ?? 'no category'}) `
    + `-- ${preset.layers.length} layer(s), ${rows.length} zone(s)`)
  console.table(rows)
  console.groupEnd()
}
