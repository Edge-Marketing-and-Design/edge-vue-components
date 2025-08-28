<script setup>
import { computed, defineProps, inject, nextTick, onBeforeMount, reactive, watch } from 'vue'
import { useToast } from '@/components/ui/toast/use-toast'
const props = defineProps({
  metaFields: {
    type: Array,
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
  props.metaFields.forEach((field) => {
    if (!(field.field in state.meta)) {
      state.meta[field.field] = field.value
    }
  })
})

watch(currentMeta, async () => {
  state.meta = currentMeta.value
  edgeGlobal.edgeState.changeTracker = {}
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
            <span class="capitalize">My Profile</span>
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
      <edge-shad-form
        v-model="state.form"
        :schema="props.formSchema"
        @submit="onSubmit"
      >
        <CardContent>
          <div v-for="field in props.metaFields" :key="field.field" class="mb-3">
            <edge-g-input
              v-model="state.meta[field.field]"
              :name="field.field"
              :field-type="field.type"
              :label="field.label"
              parent-tracker-id="profile-settings"
              :hint="field.hint"
            />
          </div>
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
    </CardContent>
  </Card>
</template>

<style lang="scss" scoped>

</style>
