<script setup>
import { computed, defineProps, inject, nextTick, reactive, watch } from 'vue'

const props = defineProps({
  registrationCode: {
    type: String,
    default: '',
  },
  title: {
    type: String,
    default: 'My Organizations',
  },
})

const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')

const state = reactive({
  loaded: true,
})

const roles = computed(() => {
  return edgeFirebase.user.roles
})

watch(roles, async () => {
  await edgeGlobal.getOrganizations(edgeFirebase)
  state.loaded = false
  await nextTick()
  state.loaded = true
})
</script>

<template>
  <div>
    <edge-g-input
      v-if="state.loaded"
      v-model="edgeGlobal.edgeState.organizations"
      name="organizations"
      :disable-tracking="true"
      field-type="objectList"
      sub-field-type="edge-form-subtypes-my-orgs"
      :label="props.title"
      parent-tracker-id="myOrgs"
      :pass-through-props="props.registrationCode"
    />
  </div>
</template>

<style lang="scss" scoped>

</style>
