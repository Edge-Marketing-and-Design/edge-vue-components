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
const route = useRoute()
</script>

<template>
  <Card class="w-full flex-1 bg-muted/50 mx-auto w-full border-none shadow-none pt-2">
    <slot name="header">
      <edge-menu class="bg-secondary text-foreground rounded-none sticky top-0 py-6">
        <template #start>
          <slot name="header-start">
            <component :is="edgeGlobal.iconFromMenu(route)" class="mr-2" />
            <span class="capitalize">Members</span>
          </slot>
        </template>
        <template #center>
          <slot name="header-center">
            <div class="w-full px-6" />
          </slot>
        </template>
        <template #end>
          <slot name="header-end">
            <div />
          </slot>
        </template>
      </edge-menu>
    </slot>
    <CardContent v-if="state.loaded" class="p-3 w-full overflow-y-auto scroll-area">
      <edge-g-input
        v-if="state.loaded"
        v-model="users"
        name="users"
        :disable-tracking="true"
        field-type="objectList"
        sub-field-type="users"
        parent-tracker-id="users"
      />
    </CardContent>
  </Card>
</template>

<style lang="scss" scoped>

</style>
