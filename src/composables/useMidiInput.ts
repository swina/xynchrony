// Plain reactive singleton wrapping core/midi/MidiInput.ts (no Pinia --
// see docs/ARCHITECTURE.md).
import { ref } from 'vue'
import { MidiInput, type MidiDeviceInfo } from '../core/midi/MidiInput'

const devices = ref<MidiDeviceInfo[]>([])
const selectedId = ref<string | null>(null)
const initialized = ref(false)

async function init() {
  if (initialized.value) return
  devices.value = await MidiInput.init()
  selectedId.value = MidiInput.selectedInputId
  MidiInput.onDeviceListChange((list) => {
    devices.value = list
    selectedId.value = MidiInput.selectedInputId
  })
  initialized.value = true
}

function selectDevice(id: string | null) {
  MidiInput.selectDevice(id)
  selectedId.value = id
}

export function useMidiInput() {
  return {
    isSupported: MidiInput.isSupported,
    devices,
    selectedId,
    initialized,
    init,
    selectDevice,
  }
}
