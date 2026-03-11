<script setup>
import { renderTemplate } from '@edgedev/template-engine'

const props = defineProps({
  content: {
    type: String,
    default: '',
  },
  values: {
    type: Object,
    default: () => ({}),
  },
  meta: {
    type: Object,
    default: () => ({}),
  },
  theme: {
    type: Object,
    default: null,
  },
  isolated: {
    type: Boolean,
    default: true,
  },
  viewportMode: {
    type: String,
    default: 'auto',
  },
  renderContext: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['loaded'])

const defaultTheme = {
  extend: {
    colors: {
      brand: '#3B82F6',
      accent: '#F59E0B',
      surface: '#FAFAFA',
      subtle: '#F3F4F6',
      text: '#1F2937',
      muted: '#9CA3AF',
      success: '#22C55E',
      danger: '#EF4444',
    },
    fontFamily: {
      sans: ['Overpass', 'sans-serif'],
      serif: ['Kode Mono', 'monospace'],
      mono: ['Overpass', 'sans-serif'],
      brand: ['Kode Mono', 'monospace'],
    },
  },
  apply: {},
  slots: {},
  variants: {
    light: { apply: {} },
    dark: { apply: {}, slots: {} },
  },
}

const theme = computed(() => props.theme ?? defaultTheme)
const renderValues = computed(() => {
  const baseValues = props.values || {}
  if (!props.renderContext || typeof props.renderContext !== 'object' || Array.isArray(props.renderContext))
    return baseValues

  return {
    ...props.renderContext,
    renderBlocks: props.renderContext,
    renderItem: props.renderContext,
    ...baseValues,
  }
})

const rendered = computed(() => {
  return renderTemplate(props.content, renderValues.value, props.meta)
})
</script>

<template>
  <edge-cms-html-content
    :html="rendered"
    :theme="theme"
    :isolated="props.isolated"
    :viewport-mode="props.viewportMode"
    @loaded="emit('loaded')"
  />
</template>

<style scoped>
</style>
