<script setup>
import { injectDialogRootContext } from 'reka-ui'

defineOptions({
  inheritAttrs: false,
})

const rootContext = injectDialogRootContext()

const handleCloseAutoFocus = (event) => {
  event.preventDefault()
  const triggerEl = rootContext.triggerElement.value
  if (!triggerEl)
    return
  try {
    triggerEl.focus({ preventScroll: true })
  }
  catch {
    triggerEl.focus()
  }
}
</script>

<template>
  <SheetContent v-bind="$attrs" @close-auto-focus="handleCloseAutoFocus">
    <slot />
  </SheetContent>
</template>
