<script setup>
import { computed, defineProps, inject, nextTick, onBeforeMount, reactive, watch } from 'vue'
import { useToast } from '@/components/ui/toast/use-toast'
const props = defineProps({
  metaFields: {
    type: Object,
    required: true,
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
  meta: {},
  name: '',
  form: false,
  loaded: true,
  loading: false,
})
const onSubmit = async () => {
  state.loading = true
  await edgeFirebase.setUserMeta(state.meta)
  edgeGlobal.edgeState.changeTracker = {}
  state.loaded = false
  toast({
    title: 'Updated Successfully',
    description: 'Your profile has been updated',
    duration: 1000,
  })
  state.loading = false
  await nextTick()
  state.loaded = true
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
  <Card v-if="state.loaded" class="bg-transparent border-0">
    <edge-shad-form
      v-model="state.form"
      :schema="props.formSchema"
      @submit="onSubmit"
    >
      <CardHeader class="pt-3">
        <CardTitle class="text-lg">
          My Profile
        </CardTitle>
      </CardHeader>
      <CardContent>
        <edge-g-input
          v-for="field in props.metaFields"
          :key="field.field"
          v-model="state.meta[field.field]"
          :name="field.field"
          :field-type="field.type"
          :label="field.label"
          parent-tracker-id="profile-settings"
          :hint="field.hint"
        />
      </CardContent>
      <CardFooter>
        <edge-shad-button
          type="submit"
          :disabled="state.loading"
          class="text-white bg-slate-800 hover:bg-slate-400"
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
