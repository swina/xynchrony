#!/usr/bin/env python3
"""
Manual/visual validation gate for the envelope/filter/LFO/mod-matrix fields
build_bank.py decodes. There's no independent ground truth beyond "does
this look musically plausible", so this script decodes and pretty-prints a
curated set of presets picked because their names strongly predict a
distinctive envelope/filter shape, for a human to eyeball:

  - "pad" names: expect slow attack, high sustain, slow release
  - "pluck"/"stab" names: expect fast attack/decay, low sustain
  - "sweep"/"wow" names: expect a populated mod-matrix slot targeting
    filterFreq, and non-trivial filterEnv/lfo1 values

Usage: python3 tools/validate_voice_params.py [path/to/bank.json]
"""
import json
import sys

BANK_PATH = sys.argv[1] if len(sys.argv) > 1 else 'public/data/banks/orbit-3/bank.json'

KEYWORDS = {
    'pad': 'slow attack, high sustain, slow release expected',
    'pluck': 'fast attack/decay, low sustain expected',
    'stab': 'fast attack/decay, low sustain expected',
    'sweep': 'populated mod-matrix -> filterFreq, moving filterEnv/lfo1 expected',
    'wow': 'populated mod-matrix -> filterFreq, moving filterEnv/lfo1 expected',
}


def summarize_env(env):
    return (f"A1({env['attack1Rate']},{env['attack1Level']}) "
            f"D1({env['decay1Rate']},sus={env['sustainLevel']}) "
            f"R1({env['release1Rate']},{env['release1Level']})")


def main():
    bank = json.load(open(BANK_PATH, encoding='utf-8'))
    presets = bank['presets']
    print(f"Loaded {len(presets)} presets from {BANK_PATH}\n")

    matched = []
    for bank_prog, p in presets.items():
        name_lower = p['name'].lower()
        for kw, expectation in KEYWORDS.items():
            if kw in name_lower:
                matched.append((bank_prog, p, kw, expectation))
                break

    print(f"Matched {len(matched)} presets across keywords: {sorted(KEYWORDS)}\n")
    print('=' * 100)

    for bank_prog, p, kw, expectation in matched[:25]:
        print(f"{bank_prog}  {p['name']}  [{p['category']}]  (matched '{kw}': {expectation})")
        for layer in p['layers']:
            filt = layer['params']['filter']
            print(f"  layer {layer['layerIndex']}: "
                  f"ampEnv {summarize_env(layer['ampEnv'])} | "
                  f"filterEnv {summarize_env(layer['filterEnv'])} | "
                  f"filter type={filt['typeEstimated']}(raw={filt['typeRaw']}) "
                  f"cutoff~{filt['cutoffHzEstimated']}Hz(raw={filt['cutoffRaw']}) res={filt['resonance']} | "
                  f"lfo1 rate={layer['lfo1']['rate']} shape={layer['lfo1']['shape']}")
            mm = layer['modMatrix']
            filter_targeting = [s for s in mm if s['destination'] in ('filterFreq', 'filterQ')]
            if filter_targeting:
                print(f"    modMatrix -> filter: {filter_targeting}")
        print('-' * 100)


if __name__ == '__main__':
    main()
