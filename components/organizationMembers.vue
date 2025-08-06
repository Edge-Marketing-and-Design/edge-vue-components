<script setup>
import { computed, inject, nextTick, reactive, watch } from 'vue'

const edgeFirebase = inject('edgeFirebase')

const state = reactive({
  loaded: true,
})

const users = computed(() => {
  const otherUsers = Object.values(edgeFirebase.state.users)

  return otherUsers
})
watch(users, async () => {
  state.loaded = false
  await nextTick()
  state.loaded = true
})
</script>

<template>
  <edge-menu class="bg-secondary text-foreground rounded-none sticky top-0 py-6">
    <template #start>
      <slot name="header-start">
        <Users class="mr-2" />
        <span class="capitalize">Users</span>
      </slot>
    </template>
    <template #end>
      <div class="hidden" />
    </template>
  </edge-menu>
  <edge-g-input
    v-if="state.loaded"
    v-model="users"
    name="users"
    :disable-tracking="true"
    field-type="objectList"
    sub-field-type="edge-form-subtypes-users"
    parent-tracker-id="users"
  />
</template>

<style lang="scss" scoped>

</style>
