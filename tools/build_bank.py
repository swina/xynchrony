#!/usr/bin/env python3
"""
Generalized E-mu EOS/E4B bank builder for EmulatorX3.

Given a compiled .e4b bank file (required), a folder of WAV exports
(required), and optionally a folder of raw .ebl per-sample files, produces
a self-contained bank JSON (public/data/banks/<bank-id>/bank.json) and
upserts an entry into public/data/banks/manifest.json.

Format background: Orbit-3.e4b was reverse-engineered against the
third-party, hardware-verified mpc2emu project's format doc
(github.com/lentferj/mpc2emu, docs/E4B_FORMAT.md). This script generalizes
that work: any bank in the same container format (FORM/E4B0/TOC1, E4P1
presets, E3S1 samples) can be imported, not just Orbit-3.

Terminology: the E4B binary's "voice" concept is called a **Layer** here,
reserving **Voice** for "one polyphonic sound-producing instance spawned at
note-on" in the frontend audio engine -- these are different concepts and
conflating them was a real source of confusion during development.

Usage:
    python3 tools/build_bank.py \
        --e4b /path/to/Bank.e4b \
        --wav-dir /path/to/WAV \
        --ebl-dir /path/to/SamplePool \
        --bank-id orbit-3 \
        --bank-name "Orbit-3"
"""
import argparse
import json
import os
import struct
import sys

VOICE_FIXED = 284
ZONE_SIZE = 22
PRESET_HEADER_SIZE = 82
SCHEMA_VERSION = 2

SOURCE_IDS = {
    0x50: 'filterEnv',
    0x60: 'lfo1Bipolar',
    0x61: 'lfo1Unipolar',
    0x68: 'lfo2Bipolar',
    0x69: 'lfo2Unipolar',
    0x0C: 'velocity',
    0x11: 'modWheel',
}
DEST_IDS = {
    0x30: 'pitch',
    0x38: 'filterFreq',
    0x39: 'filterQ',
    0x4A: 'volEnvDecay',
    0x60: 'lfo1Rate',
    0x68: 'lfo2Rate',
    0x40: 'velocityDefault',
}
LFO_SHAPES = {0: 'triangle', 1: 'sine', 2: 'sawtooth', 3: 'square'}

# Best-effort, derived from Orbit-3.txt's Presets category column matched
# against each preset name's "prefix:" convention. Works as a reasonable
# guess for other similarly-conventioned E-mu EOS banks; unrecognized
# prefixes just fall back to None (category left unset, not fabricated).
CATEGORY_BY_PREFIX = {
    'hit': 'Hit', 'bpm': 'BPM', 'syn': 'Synthesizer', 'kit': 'Kit',
    'pad': 'Pad', 'tec': 'Tech', 'bas': 'Bass', 'org': 'Organ',
    'sfx': 'SFX', 'wnd': 'Wind', 'amb': 'Ambient', 'led': 'Lead',
    'sub': 'Sub Bass', 'prc': 'Percussion', 'vox': 'Vocal',
    'arp': 'Arpeggiated', 'orc': 'Orchestral', 'git': 'Guitar',
    'brs': 'Brass', 'bts': 'Beats', 'pr1': 'Percussion',
    'pr2': 'Percussion', 'pr3': 'Percussion', 'clp': 'Hand Clap',
    'bd1': 'Bass Drum', 'bd2': 'Bass Drum', 'hh1': 'Hi-Hat',
    'cb1': 'Cymbal', 'cb2': 'Cymbal', 'tom': 'Tom', 'kb2': 'Keyboard',
    **{f'sn{i}': 'Snare Drum' for i in range(1, 8)},
}


# ---------------------------------------------------------------------------
# TOC / container parsing
# ---------------------------------------------------------------------------

def parse_toc(data):
    toc_size = struct.unpack('>I', data[16:20])[0]
    entries = []
    pos = 20
    end = 20 + toc_size
    while pos < end:
        tag = data[pos:pos + 4]
        if tag not in (b'E4P1', b'E3S1', b'E4Ma'):
            break
        dsize = struct.unpack('>I', data[pos + 4:pos + 8])[0]
        foffset = struct.unpack('>I', data[pos + 8:pos + 12])[0]
        idx = struct.unpack('>H', data[pos + 12:pos + 14])[0]
        name = data[pos + 14:pos + 30].decode('ascii', errors='ignore').split('\x00')[0].strip()
        entries.append({'tag': tag, 'size': dsize, 'offset': foffset, 'index': idx, 'name': name})
        pos += 32
    return entries


def parse_sample_header(data, entry):
    """E3S1 body: idx(2) name(16, clean) ... sample_rate at 54:58 (LE u32)."""
    body = data[entry['offset'] + 8: entry['offset'] + 8 + entry['size']]
    name = body[2:18].decode('ascii', errors='ignore').split('\x00')[0].strip()
    sample_rate = struct.unpack('<I', body[54:58])[0] if len(body) >= 58 else None
    return {'index': entry['index'], 'name': name, 'sampleRate': sample_rate}


# ---------------------------------------------------------------------------
# Layer (E4B "voice") parsing: params, envelopes, LFOs, mod matrix
# ---------------------------------------------------------------------------

def parse_layer_params(data, vpos):
    delay_ms = struct.unpack('>H', data[vpos + 28:vpos + 30])[0]
    transpose = struct.unpack('b', data[vpos + 34:vpos + 35])[0]
    fine_tune = struct.unpack('b', data[vpos + 36:vpos + 37])[0]
    non_transpose = data[vpos + 38] == 0x01
    volume_db = struct.unpack('b', data[vpos + 54:vpos + 55])[0]
    pan = struct.unpack('b', data[vpos + 55:vpos + 56])[0]
    filter_type_raw = data[vpos + 58]
    filter_cutoff_raw = data[vpos + 60]
    filter_resonance = data[vpos + 61]
    return {
        'delayMs': delay_ms,
        'transposeSemitones': transpose,
        'fineTuneCents': fine_tune,
        'nonTranspose': non_transpose,
        'volumeDb': volume_db,
        'pan': pan,
        'filter': {
            'typeRaw': filter_type_raw,
            'typeEstimated': decode_filter_type(filter_type_raw),
            'cutoffRaw': filter_cutoff_raw,
            'cutoffHzEstimated': filter_cutoff_raw_to_hz(filter_cutoff_raw),
            'resonance': filter_resonance,
        },
    }


def parse_envelope(data, base):
    """Generic 6-stage 12-byte envelope reader (amp/filter layout).

    Note: mpc2emu's doc claims bytes [12:14] are a constant 0x03 0x00
    marker. Empirically (checked against real Orbit-3 data) that is NOT
    reliably true, while the envelope values themselves vary sensibly and
    correctly grouped by underlying instrument (validated against the
    known-good HARD syn C2/C3/C4 and MINI sin C2-C6 zone data) -- so this
    byte range is preserved as 'modeMarker' for forensic use rather than
    asserted against, which was producing 100% false-positive warnings.
    """
    return {
        'attack1Rate': data[base + 0], 'attack1Level': data[base + 1],
        'attack2Rate': data[base + 2], 'attack2Level': data[base + 3],
        'decay1Rate': data[base + 4], 'sustainLevel': data[base + 5],
        'decay2Rate': data[base + 6], 'decay2Level': data[base + 7],
        'release1Rate': data[base + 8], 'release1Level': data[base + 9],
        'release2Rate': data[base + 10], 'release2Level': data[base + 11],
        'modeMarker': data[base + 12:base + 14].hex(),
    }


def parse_aux_envelope(data, base):
    """Same 12 bytes, but on-disk stage order is A1,D1,R1,A2,D2,R2 --
    remapped here to the same field-naming convention as the other two
    envelopes, with the raw disk order preserved for debugging. See
    parse_envelope() for why the trailing 2 bytes are kept as 'modeMarker'
    rather than asserted against."""
    a1r, a1l = data[base + 0], data[base + 1]
    d1r, d1l = data[base + 2], data[base + 3]
    r1r, r1l = data[base + 4], data[base + 5]
    a2r, a2l = data[base + 6], data[base + 7]
    d2r, d2l = data[base + 8], data[base + 9]
    r2r, r2l = data[base + 10], data[base + 11]
    return {
        'attack1Rate': a1r, 'attack1Level': a1l,
        'decay1Rate': d1r, 'decay1Level': d1l,
        'release1Rate': r1r, 'release1Level': r1l,
        'attack2Rate': a2r, 'attack2Level': a2l,
        'decay2Rate': d2r, 'decay2Level': d2l,
        'release2Rate': r2r, 'release2Level': r2l,
        'modeMarker': data[base + 12:base + 14].hex(),
        '_rawStageOrder': 'A1,D1,R1,A2,D2,R2 (as stored on disk; other fields here are already remapped)',
    }


def parse_lfo(data, base):
    rate = data[base + 0]
    shape_raw = data[base + 1]
    delay = data[base + 2]
    variation = data[base + 3]
    sync_raw = data[base + 4]
    return {
        'rate': rate,
        'shape': LFO_SHAPES.get(shape_raw, f'raw:0x{shape_raw:02X}'),
        'delay': delay,
        'variation': variation,
        'sync': 'keySync' if sync_raw == 0 else 'freeRun',
    }


def parse_mod_matrix(data, base):
    slots = []
    for i in range(20):
        slot = data[base + i * 4: base + i * 4 + 4]
        if slot == b'\x00\x00\x00\x00':
            continue
        source_raw, dest_raw, amount_raw_u, flag = slot[0], slot[1], slot[2], slot[3]
        amount_raw = struct.unpack('b', bytes([amount_raw_u]))[0]
        slots.append({
            'source': SOURCE_IDS.get(source_raw, f'raw:0x{source_raw:02X}'),
            'destination': DEST_IDS.get(dest_raw, f'raw:0x{dest_raw:02X}'),
            'amountPct': round(amount_raw / 127 * 100, 1),
            'flag': flag,
        })
    return slots


def filter_cutoff_raw_to_hz(raw):
    """Best-effort exponential estimate, NOT validated against hardware.
    See docs/ARCHITECTURE.md for the caveat.

    min_hz was originally 20.0 (a "no idea, spread it across the full
    audible range" guess). That put ~46% of all layers in the bank under
    300Hz -- a lowpass that low silences virtually all melodic/tonal
    content, leaving only low-frequency percussive transients audible.
    Confirmed against real playback: non-drum presets were silent, drum
    presets sounded fine -- exactly what a too-low cutoff floor predicts.
    Raised to 300Hz: still an unvalidated guess, but biased toward
    "wrong-but-audible" rather than "wrong-and-silent", which is the
    right failure mode to prefer until this is actually calibrated
    against hardware.
    """
    min_hz, max_hz = 300.0, 20000.0
    frac = raw / 255.0
    return round(min_hz * (max_hz / min_hz) ** frac)


def decode_filter_type(raw):
    """Not validated -- defaults every raw value to 'lowpass' (the
    overwhelmingly common type on this class of hardware). typeRaw is
    always preserved alongside so this can be refined later without a
    data re-pull."""
    return 'lowpass'


# ---------------------------------------------------------------------------
# Preset / layer / zone walking
# ---------------------------------------------------------------------------

def parse_preset_layers(data, entry):
    chunk_start = entry['offset'] + 8
    hdr = data[chunk_start:chunk_start + PRESET_HEADER_SIZE]
    num_voices = struct.unpack('>H', hdr[20:22])[0]

    layers = []
    vpos = chunk_start + PRESET_HEADER_SIZE
    prev_single_zone_hi_key = None  # chaining state, see the n_zones==1 branch below
    for layer_index in range(num_voices):
        trailer_off = struct.unpack('>H', data[vpos + 2:vpos + 4])[0]
        n_zones_bytes = trailer_off - VOICE_FIXED
        if n_zones_bytes < 0 or n_zones_bytes % ZONE_SIZE != 0:
            print(f'[!] preset {entry["index"]} layer {layer_index}: bad trailer_off={trailer_off}, '
                  f'stopping this preset\'s remaining layers', file=sys.stderr)
            break
        n_zones = n_zones_bytes // ZONE_SIZE

        params = parse_layer_params(data, vpos)
        amp_env = parse_envelope(data, vpos + 110 + 0)
        filter_env = parse_envelope(data, vpos + 110 + 14)
        aux_env = parse_aux_envelope(data, vpos + 110 + 28)
        lfo1 = parse_lfo(data, vpos + 110 + 42)
        lfo2 = parse_lfo(data, vpos + 110 + 50)
        mod_matrix = parse_mod_matrix(data, vpos + 190)

        zbase = vpos + VOICE_FIXED
        zones = []
        for z in range(n_zones):
            ze = data[zbase + z * ZONE_SIZE: zbase + z * ZONE_SIZE + ZONE_SIZE]
            zone_vol = struct.unpack('b', ze[15:16])[0]
            zone_pan = struct.unpack('b', ze[16:17])[0]
            lo_key, hi_key = ze[2], ze[5]
            lo_vel, hi_vel = ze[6], ze[9]
            if n_zones == 1:
                # Single-zone layers write a full-range 0/127 PLACEHOLDER
                # into the zone table -- confirmed against real playback
                # (hit:Intruder's "HARD syn C2" zone read loKey=0/hiKey=127
                # here, but the actual patch is split at F2). The real key
                # range lives at the voice/layer level instead: vpar[17]
                # is a genuine hi_key (confirmed: 53 = F2, matching root 48
                # = C2 + 5 semitones exactly). There is no separate stored
                # lo_key -- it's implied by chaining from the previous
                # single-zone layer's hi_key, reset to 0 whenever hi_key
                # doesn't strictly increase (signals a new instrument/
                # multisample group starting, e.g. a one-off effect layer
                # or the start of the next octave-split family). Verified
                # self-consistent across all 9 layers of hit:Intruder.
                # Velocity is overridden from vpar too, for the same
                # reason and for consistency (no observed discrepancy
                # there, but the same placeholder risk applies).
                hi_key = data[vpos + 17]
                if prev_single_zone_hi_key is None or hi_key <= prev_single_zone_hi_key:
                    lo_key = 0
                else:
                    lo_key = prev_single_zone_hi_key + 1
                prev_single_zone_hi_key = hi_key
                lo_vel, hi_vel = data[vpos + 18], data[vpos + 21]
            zones.append({
                'sampleIndex': struct.unpack('>H', ze[10:12])[0],
                'loKey': lo_key, 'hiKey': hi_key,
                'loVel': lo_vel, 'hiVel': hi_vel,
                'rootKey': ze[14],
                'fineTune': struct.unpack('>h', ze[12:14])[0],
                'volumeDb': zone_vol if n_zones > 1 else None,
                'pan': zone_pan if n_zones > 1 else None,
            })

        layers.append({
            'layerIndex': layer_index,
            'params': params,
            'ampEnv': amp_env,
            'filterEnv': filter_env,
            'auxEnv': aux_env,
            'lfo1': lfo1,
            'lfo2': lfo2,
            'modMatrix': mod_matrix,
            'zones': zones,
        })
        vpos += trailer_off
    return layers


# ---------------------------------------------------------------------------
# .ebl name decoding (secondary WAV-resolution hint)
# ---------------------------------------------------------------------------

def decode_ebl_name(path):
    try:
        with open(path, 'rb') as f:
            header = f.read(160)
    except OSError:
        return None
    if header[0:4] != b'FORM':
        return None
    name_bytes = header[34:34 + 62]
    name = name_bytes.decode('utf-16-le', errors='ignore').split('\x00')[0].strip()
    return name or None


def load_ebl_names(ebl_dir):
    """Returns list of (decoded_name, ebl_filename)."""
    if not ebl_dir or not os.path.isdir(ebl_dir):
        return []
    out = []
    for fname in sorted(os.listdir(ebl_dir)):
        if not fname.lower().endswith('.ebl'):
            continue
        name = decode_ebl_name(os.path.join(ebl_dir, fname))
        if name:
            out.append((name, fname))
    return out


# ---------------------------------------------------------------------------
# WAV filename resolution
# ---------------------------------------------------------------------------

def resolve_wav_filename(sample_name, wav_stems, ebl_names):
    """wav_stems: dict of {stem_lower: actual_filename}.
    ebl_names: list of (decoded_ebl_name, ebl_filename) for fallback hints.
    Returns the resolved WAV filename, or None if unresolved.
    """
    key = sample_name.lower()
    if key in wav_stems:
        return wav_stems[key]

    # 16-char E4B name truncation: sample_name may be cut short; look for
    # a WAV stem that starts with it.
    truncated = key[:16]
    candidates = sorted(stem for stem in wav_stems if stem.startswith(truncated))
    if candidates:
        return wav_stems[candidates[0]]

    # .ebl fallback: find an .ebl whose fuller decoded name is consistent
    # with sample_name (exact or truncation-prefix), then use THAT fuller
    # name to prefix-match the WAV pool (handles cases where the E4B's own
    # truncation and the WAV naming diverge in a way the two can't bridge
    # directly, e.g. "Piz E3 open a nr" (e4b, 16 chars) -> ebl decodes the
    # same sample as "Piz E3 open a nr1" -> matches "Piz E3 open a nr1.wav").
    for ebl_name, _ in ebl_names:
        ebl_key = ebl_name.lower()
        if ebl_key == key or ebl_key.startswith(truncated) or key.startswith(ebl_key[:16]):
            candidates = sorted(stem for stem in wav_stems if stem.startswith(ebl_key))
            if candidates:
                return wav_stems[candidates[0]]

    return None


# ---------------------------------------------------------------------------
# WAV loop-region metadata (RIFF 'smpl' chunk)
# ---------------------------------------------------------------------------

def read_wav_loop_info(wav_path):
    """Reads the RIFF 'smpl' chunk (standard sampler metadata: unity note +
    loop points, in sample frames) from a WAV file.

    This turned out to matter a great deal: many sustained/tonal samples in
    this bank (pads, synth voices) are exported as short loop-cycle
    waveforms meant to repeat indefinitely while a note is held -- e.g. one
    "MINI sin" family sample is a 35ms, ~1500-frame buffer whose loop region
    covers nearly the whole thing. Playing such a buffer once, unlooped
    (which is what the engine did before this was added), produces
    something at or below the threshold of audibility -- while one-shot
    drum hits (no 'smpl' chunk at all) sound complete either way. This is
    the real explanation for "drums sound fine, everything else doesn't."

    Returns {'loopStart': int, 'loopEnd': int, 'isLooping': bool} in sample
    frames, or None if the file has no loop chunk / isn't a standard
    canonical WAV.
    """
    try:
        with open(wav_path, 'rb') as f:
            header = f.read(12)
            if header[0:4] != b'RIFF' or header[8:12] != b'WAVE':
                return None
            while True:
                chunk_header = f.read(8)
                if len(chunk_header) < 8:
                    return None
                chunk_id, chunk_size = struct.unpack('<4sI', chunk_header)
                if chunk_id == b'smpl':
                    body = f.read(chunk_size)
                    if len(body) < 36:
                        return None
                    num_loops = struct.unpack('<I', body[32:36])[0]
                    if num_loops == 0 or len(body) < 52:
                        return {'loopStart': 0, 'loopEnd': 0, 'isLooping': False}
                    loop_start = struct.unpack('<I', body[44:48])[0]
                    loop_end = struct.unpack('<I', body[48:52])[0]
                    return {'loopStart': loop_start, 'loopEnd': loop_end, 'isLooping': True}
                f.seek(chunk_size + (chunk_size % 2), 1)
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build_bank(e4b_path, wav_dir, ebl_dir, bank_id, bank_name, output_dir):
    data = open(e4b_path, 'rb').read()
    if data[0:4] != b'FORM' or data[8:12] != b'E4B0':
        raise ValueError(f'{e4b_path} does not look like an E4B0 bank file')

    toc = parse_toc(data)
    preset_entries = [e for e in toc if e['tag'] == b'E4P1']
    sample_entries = [e for e in toc if e['tag'] == b'E3S1']
    print(f'[*] TOC: {len(preset_entries)} presets, {len(sample_entries)} samples')

    samples_by_index = {}
    for e in sample_entries:
        s = parse_sample_header(data, e)
        samples_by_index[s['index']] = s

    wav_files = sorted(f for f in os.listdir(wav_dir) if f.lower().endswith('.wav')) if os.path.isdir(wav_dir) else []
    wav_stems = {os.path.splitext(f)[0].lower(): f for f in wav_files}
    print(f'[*] WAV dir: {len(wav_files)} files')

    ebl_names = load_ebl_names(ebl_dir)
    print(f'[*] .ebl dir: {len(ebl_names)} decodable names' if ebl_dir else '[*] .ebl dir: not provided')

    presets_out = {}
    total_layers = 0
    total_zones = 0
    unresolved = 0
    looping_zones = 0
    wav_cache = {}
    loop_info_cache = {}

    for e in preset_entries:
        idx = e['index']
        bank, prog = divmod(idx, 128)
        bank_prog = f'{bank:03d}:{prog:03d}'
        layers = parse_preset_layers(data, e)
        total_layers += len(layers)

        for layer in layers:
            for zone in layer['zones']:
                total_zones += 1
                s = samples_by_index.get(zone['sampleIndex'])
                sample_name = s['name'] if s else None
                zone['sampleName'] = sample_name
                zone['sampleRate'] = s['sampleRate'] if s else None
                if sample_name is None:
                    zone['wavFile'] = None
                    unresolved += 1
                    continue
                if sample_name not in wav_cache:
                    wav_cache[sample_name] = resolve_wav_filename(sample_name, wav_stems, ebl_names)
                wav_file = wav_cache[sample_name]
                zone['wavFile'] = wav_file
                if wav_file is None:
                    unresolved += 1
                    zone['loopStart'] = 0
                    zone['loopEnd'] = 0
                    zone['isLooping'] = False
                    continue
                if wav_file not in loop_info_cache:
                    loop_info_cache[wav_file] = read_wav_loop_info(os.path.join(wav_dir, wav_file))
                loop_info = loop_info_cache[wav_file] or {'loopStart': 0, 'loopEnd': 0, 'isLooping': False}
                zone['loopStart'] = loop_info['loopStart']
                zone['loopEnd'] = loop_info['loopEnd']
                zone['isLooping'] = loop_info['isLooping']
                if loop_info['isLooping']:
                    looping_zones += 1

        prefix = e['name'].split(':', 1)[0].lower() if ':' in e['name'] else None
        category = CATEGORY_BY_PREFIX.get(prefix)

        presets_out[bank_prog] = {
            'name': e['name'],
            'category': category,
            'layers': layers,
        }

    output = {
        '_meta': {
            'schemaVersion': SCHEMA_VERSION,
            'bankId': bank_id,
            'bankName': bank_name,
            'source': os.path.basename(e4b_path),
            'rootKeyConvention': 'E-mu octave convention: C3 = MIDI 60 (middle C)',
            'presetCount': len(presets_out),
            'totalLayers': total_layers,
            'totalZones': total_zones,
            'unresolvedSamples': unresolved,
            'loopingZones': looping_zones,
            'notes': {
                'filterCutoffCurve': 'NOT VALIDATED -- best-effort exponential estimate, see filter_cutoff_raw_to_hz()',
                'filterTypeEnum': 'NOT VALIDATED -- raw byte preserved as filterTypeRaw, typeEstimated always "lowpass"',
            },
        },
        'presets': presets_out,
    }

    bank_out_dir = os.path.join(output_dir, bank_id)
    os.makedirs(bank_out_dir, exist_ok=True)
    bank_path = os.path.join(bank_out_dir, 'bank.json')
    with open(bank_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f'[+] Wrote {bank_path}')
    print(f'[+] {len(presets_out)} presets, {total_layers} layers, {total_zones} zones, '
          f'{unresolved} unresolved sample->wav lookups')

    update_manifest(output_dir, bank_id, bank_name, len(presets_out))
    return output


def update_manifest(output_dir, bank_id, bank_name, preset_count):
    manifest_path = os.path.join(output_dir, 'manifest.json')
    manifest = {'banks': []}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding='utf-8') as f:
            manifest = json.load(f)

    manifest['banks'] = [b for b in manifest['banks'] if b['id'] != bank_id]
    manifest['banks'].append({
        'id': bank_id,
        'name': bank_name,
        'presetCount': preset_count,
        'schemaVersion': SCHEMA_VERSION,
    })
    manifest['banks'].sort(key=lambda b: b['id'])

    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f'[+] Updated {manifest_path} ({len(manifest["banks"])} bank(s) listed)')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--e4b', required=True, help='Path to the compiled .e4b bank file')
    parser.add_argument('--wav-dir', required=True, help='Folder of browser-playable WAV exports')
    parser.add_argument('--ebl-dir', default=None, help='Folder of raw .ebl per-sample files (optional)')
    parser.add_argument('--bank-id', required=True, help='Short id, e.g. "orbit-3" (used in URLs/paths)')
    parser.add_argument('--bank-name', required=True, help='Display name, e.g. "Orbit-3"')
    parser.add_argument('--output-dir', default=None,
                         help='Defaults to <script dir>/../public/data/banks')
    args = parser.parse_args()

    output_dir = args.output_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'banks')
    output_dir = os.path.normpath(output_dir)

    build_bank(args.e4b, args.wav_dir, args.ebl_dir, args.bank_id, args.bank_name, output_dir)


if __name__ == '__main__':
    main()
