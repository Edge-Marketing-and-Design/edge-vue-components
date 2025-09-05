<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { install, observe } from '@twind/core'
import presetTailwind from '@twind/preset-tailwind'
import DOMPurify from 'dompurify'

const props = defineProps({ html: { type: String, default: '' } })

const hostEl = ref(null)
let stopObserving = null
let twind

function renderSafeHtml(content) {
  if (hostEl.value) {
    // sanitize, allow class attributes so Tailwind/Twind still work
    const safeHtml = DOMPurify.sanitize(content, { ADD_ATTR: ['class'] })
    hostEl.value.innerHTML = safeHtml
  }
}

onMounted(() => {
  twind = install({
    presets: [presetTailwind()],
    mode: 'silent', // suppress warnings (strict|warn|silent)
  })
  stopObserving = observe(twind, hostEl.value)

  renderSafeHtml(props.html)
})

watch(() => props.html, (val) => {
  renderSafeHtml(val || '')
})

onBeforeUnmount(() => {
  if (stopObserving)
    stopObserving()
})
</script>

<template>
  <!-- Twind only interprets inside this container -->
  <div ref="hostEl" class="block-content" />
</template>
