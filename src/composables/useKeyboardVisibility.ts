// Plain reactive singleton (matches useMidiLearn.ts/useGlobalFx.ts's
// pattern) for the on-screen keyboard + voice-activity meter layer's
// show/hide state (PerformanceFooter.vue) -- a module-level ref rather
// than component-local state because the toggle button lives in
// TransportToolbar.vue while the layer it shows/hides is a sibling in
// PerformanceFooter.vue, and App.vue needs the same flag to size the
// page's reserved bottom padding (.sd-page-main) -- three separate
// component trees with no direct parent/child relationship to prop-drill
// through.
import { ref } from 'vue'

const visible = ref(true)

function toggle() {
  visible.value = !visible.value
}

export function useKeyboardVisibility() {
  return { visible, toggle }
}
