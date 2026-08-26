// Local machine paths to each bank's source assets (the --wav-dir given to
// tools/build_bank.py). This file only drives `npm run sync-assets`
// (mirroring WAV audio into public/wav/<bank-id>/) -- it does NOT rebuild
// bank.json; re-run tools/build_bank.py by hand for that.
//
// Add an entry here for every bank you've built with tools/build_bank.py.
export default [
  {
    id: 'orbit-3',
    wavDir: '/home/antonio/personal/apps/tools/emu-extractor/WAV',
  },
];
