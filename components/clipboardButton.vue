<script setup>
import { useToast } from '@/components/ui/toast/use-toast'

const props = defineProps({
  text: {
    type: String,
    required: true,
  },
})
const { toast } = useToast()
const state = reactive({
  buttonIcon: 'Copy',
})

const copyToClipboard = async (text) => {
  await navigator.clipboard.writeText(text)
  state.buttonIcon = 'Check'
  // toast({
  //   title: '',
  //   description: 'Copied to clipboard',
  //   duration: 1000,
  // })
  setTimeout(() => {
    state.buttonIcon = 'Copy'
  }, 3000)
}
</script>

<template>
  <edge-shad-button
    class="w-4 h-4 mt-1"
    size="icon"
    variant="text"
    @click.stop.prevent="copyToClipboard(props.text)"
  >
    <component :is="state.buttonIcon" class="w-4 h-4" />
  </edge-shad-button>
</template>

<style lang="scss" scoped>

</style>
