#!/usr/bin/env node
// Mirrors each configured bank's WAV audio into public/wav/<bank-id>/, so
// `npm run dev` / `npm run build` always serve whatever tools/build_bank.py
// was last pointed at. Skips files that already match by size (WAV assets
// don't change once exported, and this runs on every dev/build start via
// the predev/prebuild hooks in package.json).
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import banks from './banks.config.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

for (const bank of banks) {
  if (!existsSync(bank.wavDir)) {
    console.warn(`[sync-assets] skipping "${bank.id}": wavDir not found: ${bank.wavDir}`);
    continue;
  }
  const destDir = join(projectRoot, 'public', 'wav', bank.id);
  mkdirSync(destDir, { recursive: true });

  const files = readdirSync(bank.wavDir).filter((f) => f.toLowerCase().endsWith('.wav'));
  let copied = 0;
  let skipped = 0;
  for (const file of files) {
    const src = join(bank.wavDir, file);
    const dest = join(destDir, file);
    if (existsSync(dest) && statSync(dest).size === statSync(src).size) {
      skipped++;
      continue;
    }
    copyFileSync(src, dest);
    copied++;
  }
  console.log(`[sync-assets] "${bank.id}": ${copied} copied, ${skipped} already up to date (${files.length} total)`);
}
