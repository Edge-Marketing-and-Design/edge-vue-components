<script setup>
import { computed, defineProps, inject, nextTick, onBeforeMount, reactive, watch } from 'vue'

const props = defineProps({
  metaFields: {
    type: Object,
    required: true,
  },
})
const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')

const state = reactive({
  meta: {},
  name: '',
  form: false,
  loaded: true,
})
const onSubmit = async (event) => {
  const results = await event
  if (results.valid) {
    edgeFirebase.setUserMeta(state.meta)
    edgeGlobal.edgeState.changeTracker = {}
    state.loaded = false
    await nextTick()
    state.loaded = true
  }
}

const currentMeta = computed(() => {
  return edgeFirebase.user.meta
})

onBeforeMount(() => {
  state.meta = currentMeta.value
})

watch(currentMeta, async () => {
  state.meta = currentMeta.value
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
      <v-card-text>
        <h3 class="mb-3">
          My Profile
        </h3>
        <edge-g-input
          v-for="field in props.metaFields"
          :key="field.field"
          v-model="state.meta[field.field]"
          :name="field.field"
          :field-type="field.type"
          :rules="field.rules"
          :label="field.label"
          parent-tracker-id="profile-settings"
          :hint="field.hint"
          persistent-hint
        />
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
