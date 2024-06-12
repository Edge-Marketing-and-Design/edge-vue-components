<!-- eslint-disable vue/no-v-text-v-html-on-component -->
<script setup>
import { computed, defineProps, reactive } from 'vue'
const props = defineProps({
  helper: {
    type: String,
    default: null,
  },
})

const state = reactive({
  titles: [
    'Help, Help, and Help',
    'Help Is on the Way',
    'Help Me, Rhonda',
    'Help Is Here',
    'Help! I Need Somebody',
    'Here to Help',
    'You Got This',
    'Just Ask',
    'Gotcha Covered',
    'Helping Hand',
    'Assistance Available',
    'Lend a Hand',
    'In Need of Assistance',
    'I\'m Here to Help',
    'Never Alone',
    'Together We Can',
    'We\'ve Got Your Back',
    'Ask and You Shall Receive',
    'Let Me Know How I Can Help',
    'Help Me Help You',
  ],
})
const title = computed(() => {
  return state.titles[Math.floor(Math.random() * state.titles.length)]
})
</script>

<template>
  <v-menu v-if="props.helper" class="ml-3">
    <template #activator="{ props }">
      <!-- <v-btn size="small" icon>
        <v-icon v-bind="props">
          mdi-help-circle
        </v-icon>
      </v-btn> -->
      <v-icon size="small" class="mx-1" v-bind="props">
        mdi-help-circle
      </v-icon>
    </template>
    <v-card class="helper" density="compact" max-width="600">
      <v-toolbar class="pl-2" density="compact">
        {{ title }}
        <v-spacer />
        <v-icon class="mr-2">
          mdi-help-rhombus
        </v-icon>
      </v-toolbar>
      <v-card-text class="px-8">
        <div v-html="props.helper" />
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<style lang="scss">
.helper ul {
    margin-bottom: 20px !important;
    margin-left: 20px !important;
}
.helper p{
  margin-bottom: 20px !important;
}
</style>
