<script setup>
const props = defineProps({
  isOverrideBlock: {
    type: Boolean,
    default: false,
  },
  overlay: {
    type: Boolean,
    default: true,
  },
  scaleCompensation: {
    type: Number,
    default: 1,
  },
})

const badgeStyle = computed(() => {
  const scale = Number(props.scaleCompensation)
  const safeScale = (Number.isFinite(scale) && scale > 0) ? scale : 1

  if (!props.overlay && safeScale === 1)
    return undefined

  return {
    transform: props.overlay
      ? `translateY(-50%) scale(${safeScale})`
      : `scale(${safeScale})`,
    transformOrigin: props.overlay ? 'left center' : 'top left',
  }
})
</script>

<template>
  <div
    v-if="isOverrideBlock"
    data-cms-override-block-badge
    class="pointer-events-none inline-flex items-center rounded-full border border-violet-300 bg-violet-950/90 px-2 py-1 text-[10px] font-semibold uppercase leading-none tracking-wide text-violet-50 shadow-lg backdrop-blur-sm dark:border-violet-400 dark:bg-violet-950/95 dark:text-violet-100"
    :class="overlay ? 'absolute left-2 top-1/2 z-[10002]' : ''"
    :style="badgeStyle"
  >
    Override Block
  </div>
</template>
