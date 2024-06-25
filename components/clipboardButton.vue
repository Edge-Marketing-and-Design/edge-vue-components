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
  snackbar: false,
  buttonIcon: 'mdi-content-copy',
})

const showToast = () => {
  toast({
    title: '',
    description: 'Copied to clipboard',
    duration: 3000,
  })
}

const copyToClipboard = async (text) => {
  showToast()
  await navigator.clipboard.writeText(text)
  state.buttonIcon = 'mdi-check'
  setTimeout(() => {
    state.buttonIcon = 'mdi-content-copy'
  }, 3000)
}
</script>

<template>
  <!-- <v-btn
    variant="text"
    icon
    size="small"
    @click.stop="copyToClipboard(props.text)"
  > -->
  <v-icon
    size="small"
    class="mx-1"
    @click.stop.prevent="copyToClipboard(props.text)"
  >
    {{ state.buttonIcon }}
  </v-icon>
  <v-snackbar
    v-model="state.snackbar"
    :timeout="3000"
    location="center"
  >
    Copied to clipboard
    <template #actions>
      <v-btn
        color="grey-darken-5"
        variant="text"
        @click="state.snackbar = false"
      >
        Close
      </v-btn>
    </template>
  </v-snackbar>
</template>

<style lang="scss" scoped>

</style>
