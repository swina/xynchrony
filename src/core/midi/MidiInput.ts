// Thin wrapper around the native Web MIDI API (no npm package -- see
// docs/ARCHITECTURE.md §4). Decodes raw MIDIMessageEvents into the same
// note-on/off/CC/pitch-bend calls the on-screen VirtualKeyboard uses, so
// there's exactly one trigger path into AudioEngine regardless of input
// source.
import { AudioEngine } from '../audio/AudioEngine'

export interface MidiDeviceInfo {
  id: string
  name: string
}

const STORAGE_KEY = 'emulatorx3.selectedMidiInputId'

type DeviceListener = (devices: MidiDeviceInfo[]) => void
type ControlChangeListener = (controller: number, value: number) => void

class MidiInputImpl {
  private access: MIDIAccess | null = null
  private selectedId: string | null = null
  private deviceListeners = new Set<DeviceListener>()
  private ccListeners = new Set<ControlChangeListener>()
  private supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator

  get isSupported(): boolean {
    return this.supported
  }

  get selectedInputId(): string | null {
    return this.selectedId
  }

  async init(): Promise<MidiDeviceInfo[]> {
    if (!this.supported) return []
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false })
    } catch (e) {
      console.warn('[MidiInput] requestMIDIAccess failed/denied:', e)
      return []
    }
    this.access.onstatechange = () => this.handleDeviceListChange()
    this.attachListenersToAllInputs()

    const saved = localStorage.getItem(STORAGE_KEY)
    const devices = this.listDevices()
    if (saved && devices.some((d) => d.id === saved)) {
      this.selectedId = saved
    } else if (devices.length > 0) {
      this.selectedId = devices[0].id
    }
    return devices
  }

  listDevices(): MidiDeviceInfo[] {
    if (!this.access) return []
    return [...this.access.inputs.values()].map((input) => ({ id: input.id, name: input.name ?? input.id }))
  }

  selectDevice(id: string | null): void {
    this.selectedId = id
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  }

  onDeviceListChange(listener: DeviceListener): () => void {
    this.deviceListeners.add(listener)
    return () => this.deviceListeners.delete(listener)
  }

  // Raw CC fan-out, on top of the hardcoded CC1/CC123 handling below --
  // this is what Dial.vue's MIDI Learn hooks into (see useMidiLearn.ts).
  onControlChange(listener: ControlChangeListener): () => void {
    this.ccListeners.add(listener)
    return () => this.ccListeners.delete(listener)
  }

  private handleDeviceListChange() {
    this.attachListenersToAllInputs()
    const devices = this.listDevices()
    if (this.selectedId && !devices.some((d) => d.id === this.selectedId)) {
      this.selectedId = devices[0]?.id ?? null
    } else if (!this.selectedId && devices.length > 0) {
      this.selectedId = devices[0].id
    }
    for (const listener of this.deviceListeners) listener(devices)
  }

  private attachListenersToAllInputs() {
    if (!this.access) return
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (event: MIDIMessageEvent) => this.handleMessage(input.id, event)
    }
  }

  private handleMessage(inputId: string, event: MIDIMessageEvent) {
    if (inputId !== this.selectedId) return
    const data = event.data
    if (!data || data.length === 0) return
    const status = data[0]
    const command = status & 0xf0

    switch (command) {
      case 0x90: { // Note On (velocity 0 == Note Off, per spec)
        const [, note, velocity] = data
        if (velocity === 0) AudioEngine.noteOff(note)
        else AudioEngine.noteOn(note, velocity)
        break
      }
      case 0x80: { // Note Off
        const [, note] = data
        AudioEngine.noteOff(note)
        break
      }
      case 0xB0: { // Control Change
        const [, controller, value] = data
        if (controller === 1) AudioEngine.modWheel(value / 127) // mod wheel
        else if (controller === 123) AudioEngine.panic() // all notes off
        AudioEngine.controlChange(controller, value / 127) // live Mod Matrix custom-CC sources
        for (const listener of this.ccListeners) listener(controller, value)
        break
      }
      case 0xE0: { // Pitch Bend (14-bit, two 7-bit bytes)
        const [, lsb, msb] = data
        const raw14 = (msb << 7) | lsb // 0..16383, center 8192
        const value01 = (raw14 - 8192) / 8192 // -1..1
        AudioEngine.pitchBend(value01)
        break
      }
      case 0xD0: { // Channel Pressure (Aftertouch) -- feeds the Mod Matrix "Pressure" source
        const [, pressure] = data
        AudioEngine.channelPressure(pressure / 127)
        break
      }
      default:
        break
    }
  }
}

export const MidiInput = new MidiInputImpl()
