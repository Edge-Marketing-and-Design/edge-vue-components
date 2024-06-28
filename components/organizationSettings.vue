<script setup>
import { computed, defineProps, inject, nextTick, onBeforeMount, reactive, watch } from 'vue'
import CardContent from '~/components/ui/card/CardContent.vue'

import { useToast } from '@/components/ui/toast/use-toast'
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
  formSchema: {
    type: Object,
    required: true,
  },
})
const { toast } = useToast()

const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')

const state = reactive({
  data: {},
  org: '',
  form: false,
  loaded: false,
  showSnack: false,
  successMessage: '',
  snackColor: 'success',
  loading: false,
})

const onSubmit = async () => {
  state.loading = true
  state.showSnack = false
  const result = await edgeFirebase.changeDoc('organizations', edgeGlobal.edgeState.currentOrganization, state.data)
  edgeGlobal.getOrganizations(edgeFirebase)

  edgeGlobal.edgeState.changeTracker = {}
  state.loaded = false
  let message = 'Updated Successfully'
  if (!result.success) {
    message = 'You do not have permission'
  }
  toast({
    title: '',
    description: message,
    duration: 1000,
  })
  await nextTick()
  state.loaded = true
  state.loading = false
}

const currentOrgData = computed(() => {
  if (edgeGlobal.objHas(edgeFirebase.data, edgeGlobal.edgeState.organizationDocPath) === false) {
    return ''
  }
  return edgeFirebase.data[edgeGlobal.edgeState.organizationDocPath]
})
onBeforeMount(() => {
  state.data = edgeGlobal.dupObject(currentOrgData.value)
  for (const field of props.orgFields) {
    if (edgeGlobal.objHas(state.data, field.field) === false) {
      state.data[field.field] = field.value
    }
  }
  state.loaded = true
})
watch(currentOrgData, async () => {
  edgeGlobal.edgeState.changeTracker = {}
  state.loaded = false
  await nextTick()
  state.loaded = true
})
</script>

<template>
  <Card v-if="state.loaded" class="border-0 bg-transparent">
    <edge-shad-form
      :schema="props.formSchema"
      @submit="onSubmit"
    >
      <CardHeader class="pt-3">
        <CardTitle class="text-lg">
          {{ props.title }}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <template v-for="field in props.orgFields" :key="field.field">
          <edge-g-input
            v-if="edgeGlobal.objHas(field, 'bindings')"
            v-model="state.data[field.field]"
            :name="field.field"
            v-bind="field.bindings"
            :parent-tracker-id="`org-settings-${field.field}`"
          />
          <edge-g-input
            v-else
            v-model="state.data[field.field]"
            :name="field.field"
            :field-type="field.type"
            :label="field.label"
            parent-tracker-id="org-settings"
            :hint="field.hint"
            persistent-hint
          />
        </template>
        <edge-chip class="mt-3">
          ID: {{ edgeGlobal.edgeState.currentOrganization }}
          <edge-clipboard-button :text="edgeGlobal.edgeState.currentOrganization" />
        </edge-chip>
        <Alert v-if="state.showSnack" class="bg-success mt-4 py-2 flex">
          <div>
            {{ state.successMessage }}
          </div>
          <div class="grow text-right">
            <edge-shad-button

              class="mx-2 h-6 text-xs text-white bg-slate-800"

              @click="state.showSnack = false"
            >
              Close
            </edge-shad-button>
          </div>
        </Alert>
      </CardContent>
      <CardFooter>
        <edge-shad-button
          type="submit"
          :disabled="state.loading"
          class="text-white  w-100 bg-slate-800 hover:bg-slate-400"
        >
          <Loader2 v-if="state.loading" class="w-4 h-4 mr-2 animate-spin" />
          Save
        </edge-shad-button>
      </CardFooter>
    </edge-shad-form>
  </Card>
</template>

<style lang="scss" scoped>

</style>
