<script setup>
import { computed, defineProps, inject, nextTick, onBeforeMount, reactive, watch } from 'vue'

const props = defineProps({
  orgFields: {
    type: Object,
    required: true,
  },
  title: {
    type: String,
    default: 'Organization Settings',
  },
  hideUniqueIdentifier: {
    type: Boolean,
    default: false,
  },
})
const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')

const state = reactive({
  data: {},
  org: '',
  form: false,
  loaded: true,
  showSnack: false,
  successMessage: '',
  snackColor: 'success',
})
const onSubmit = async (event) => {
  const results = await event
  console.log('results', results)
  if (results.valid) {
    const result = await edgeFirebase.changeDoc('organizations', edgeGlobal.edgeState.currentOrganization, state.data)
    // getOrganizations(edgeFirebase)

    edgeGlobal.edgeState.changeTracker = {}
    state.loaded = false
    if (result.success) {
      state.successMessage = 'Save succesful'
      state.snackColor = 'success'
    }
    else {
      state.successMessage = 'You do not have permission'
      state.snackColor = 'error'
    }
    state.showSnack = true
    await nextTick()
    state.loaded = true
  }
}
const currentOrgData = computed(() => {
  if (edgeGlobal.objHas(edgeFirebase.data, edgeGlobal.edgeState.organizationDocPath) === false) {
    return ''
  }
  return edgeFirebase.data[edgeGlobal.edgeState.organizationDocPath]
})
onBeforeMount(() => {
  state.data = currentOrgData.value
  for (const field of props.orgFields) {
    if (edgeGlobal.objHas(state.data, field.field) === false) {
      state.data[field.field] = field.value
    }
  }
})
watch(currentOrgData, async () => {
  state.org = currentOrgData.value
  edgeGlobal.edgeState.changeTracker = {}
  state.loaded = false
  await nextTick()
  state.loaded = true
})
</script>

<template>
  <v-card v-if="state.loaded" variant="flat">
    <v-form
      v-model="state.form"
      validate-on="submit"
      @submit.prevent="onSubmit"
    >
      <v-card-title class="mb-3">
        <span class="headline">{{ props.title }}</span>
      </v-card-title>
      <v-card-text>
        <template v-for="field in props.orgFields" :key="field.field">
          <edge-g-input
            v-if="edgeGlobal.objHas(field, 'bindings')"
            v-model="state.data[field.field]"
            v-bind="field.bindings"
            :parent-tracker-id="`org-settings-${field.field}`"
          />
          <edge-g-input
            v-else
            v-model="state.data[field.field]"
            :field-type="field.type"
            :rules="field.rules"
            :label="field.label"
            parent-tracker-id="org-settings"
            :hint="field.hint"
            persistent-hint
          />
        </template>
        <v-text-field
          v-if="!hideUniqueIdentifier"
          v-model="edgeGlobal.edgeState.currentOrganization"
          class="mt-5"
          variant="underlined"
          label="ID"
          readonly
          hint="Unique Identifier."
          persistent-hint
        >
          <template #prepend-inner>
            <edge-clipboard-button :text="edgeGlobal.edgeState.currentOrganization" />
          </template>
        </v-text-field>
        <v-snackbar v-model="state.showSnack" location="center" :color="state.snackColor" density="compact">
          {{ state.successMessage }}
          <template #actions>
            <v-btn
              variant="text"
              @click="state.showSnack = false"
            >
              Close
            </v-btn>
          </template>
        </v-snackbar>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          type="submit"
          color="secondary"
          variant="text"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-form>
  </v-card>
</template>

<style lang="scss" scoped>

</style>
