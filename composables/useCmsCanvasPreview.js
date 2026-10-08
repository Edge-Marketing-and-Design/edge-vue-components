// One switch for the isolated preview canvas across the Hub (block editor,
// page editor, block library, picker, theme editor, posts, templates).
// Off by default; remembered per browser. See docs/features/cms/iframe-canvas.md.
import { useState } from '#imports'

const STORAGE_KEY = 'edge-cms-canvas-preview'
// Key used while the canvas was a prototype; still read so the setting carries over.
const LEGACY_STORAGE_KEY = 'edge-cms-canvas-prototype'

export const useCmsCanvasPreview = () => {
  const enabled = useState('edge-cms-canvas-preview', () => false)
  const loaded = useState('edge-cms-canvas-preview-loaded', () => false)

  if (import.meta.client && !loaded.value) {
    loaded.value = true
    try {
      const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
      enabled.value = stored === '1'
    }
    catch {}
  }

  const setEnabled = (value) => {
    enabled.value = Boolean(value)
    try {
      localStorage.setItem(STORAGE_KEY, enabled.value ? '1' : '0')
    }
    catch {}
  }

  const toggle = () => setEnabled(!enabled.value)

  return { enabled, setEnabled, toggle }
}
