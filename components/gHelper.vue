<!-- eslint-disable vue/no-v-text-v-html-on-component -->
<script setup>
import { computed, defineProps, reactive } from 'vue'
const props = defineProps({
  helper: {
    type: String,
    default: null,
  },
  title: {
    type: String,
    default: null,
  },
})

const state = reactive({
  titles: [
    'Field Assistance',
    'Form Help',
    'Input Guide',
    'Need Assistance?',
    'Help Center',
    'Field Support',
    'Quick Help',
    'Form Assistance',
    'Guidance Available',
    'Information Station',
    'Here to Help',
    'Form Guidance',
    'Input Support',
    'Solutions Available',
    'Your Guide',
    'Support Hub',
    'Input Assistance',
    'Help Desk',
    'Support Center',
  ],
})
const newTitle = computed(() => {
  if (!props.title) {
    return state.titles[Math.floor(Math.random() * state.titles.length)]
  }
  return `${props.title} Help`
})
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="text" size="icon" class="p-0 w-5 h-5">
        <Info class="w-5 h-5" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="absolute right-0 w-screen max-w-[600px]">
      <Card class="border-0">
        <CardHeader class="py-2">
          <CardTitle class="text-xl">
            {{ newTitle }}
          </CardTitle>
        </CardHeader>
        <CardContent v-html="props.helper" />
      </Card>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<style lang="scss">
</style>
