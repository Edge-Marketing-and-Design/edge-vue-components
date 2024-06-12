<script setup>
import { defineProps, reactive } from 'vue'
const props = defineProps({
  text: {
    type: String,
    required: true,
  },
})
const state = reactive({
  snackbar: false,
  buttonIcon: 'mdi-content-copy',
})
const copyToClipboard = async (text) => {
  state.snackbar = true
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
    @click.stop="copyToClipboard(props.text)"
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
  <!-- </v-btn> -->
</template>

<style lang="scss" scoped>

</style>
