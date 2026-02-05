<script setup>
import { computed, defineProps, inject, nextTick, onBeforeMount, reactive, ref, watch } from 'vue'
import { toTypedSchema } from '@vee-validate/zod'
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
const edgeGlobal = inject('edgeGlobal')

const formRef = ref(null)

const state = reactive({
  meta: {},
  name: '',
  form: false,
  loaded: true,
  loading: false,
})

const cloneMeta = (meta) => {
  if (edgeGlobal?.dupObject)
    return edgeGlobal.dupObject(meta || {})
  return JSON.parse(JSON.stringify(meta || {}))
}

const disabledNoteText = 'Contact admin to change.'

const getDisabledNote = (field) => {
  if (!field?.disabled)
    return ''
  return field?.disabledNote || disabledNoteText
}

const mergeDisabledNote = (text, field) => {
  const note = getDisabledNote(field)
  if (!note)
    return text || ''
  if (text)
    return `${text} ${note}`
  return note
}

const WIDTHS = {
  1: 'md:col-span-1',
  2: 'md:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
  5: 'md:col-span-5',
  6: 'md:col-span-6',
  7: 'md:col-span-7',
  8: 'md:col-span-8',
  9: 'md:col-span-9',
  10: 'md:col-span-10',
  11: 'md:col-span-11',
  12: 'md:col-span-12',
}

const numColsToTailwind = cols => WIDTHS[cols] || 'md:col-span-12'

const resolvedSchema = computed(() => {
  if (!props.formSchema)
    return undefined
  if (props.formSchema?.safeParse && props.formSchema?._def)
    return toTypedSchema(props.formSchema)
  return props.formSchema
})

const defaultFields = [
  { field: 'profilephoto', value: '' },
  { field: 'name', value: '' },
  { field: 'phone', value: '' },
]

const filteredMetaFields = computed(() => {
  const skipFields = new Set(['profilephoto', 'name', 'phone', 'email', 'role'])
  return (props.metaFields || []).filter(field => !skipFields.has(field.field))
})

const initializeDefaults = (meta) => {
  defaultFields.forEach((field) => {
    if (!(field.field in meta))
      meta[field.field] = field.value
  })
  filteredMetaFields.value.forEach((field) => {
    const current = getByPath(meta, field.field, undefined)
    if (current === undefined)
      setByPath(meta, field.field, field.value)
  })
}

// Helpers to read/write nested keys like "profile.firstName" on plain objects
function getByPath(obj, path, fallback = undefined) {
  if (!obj || !path)
    return fallback
  const parts = String(path).split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur))
      return fallback
    cur = cur[p]
  }
  return cur
}

function setByPath(obj, path, value) {
  if (!obj || !path)
    return
  const parts = String(path).split('.')
  let cur = obj
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]
    if (i === parts.length - 1) {
      cur[key] = value
    }
    else {
      if (cur[key] == null || typeof cur[key] !== 'object')
        cur[key] = {}
      cur = cur[key]
    }
  }
}

const mergeDeep = (target, source) => {
  if (!source || typeof source !== 'object')
    return target
  Object.keys(source).forEach((key) => {
    const value = source[key]
    if (Array.isArray(value)) {
      target[key] = [...value]
      return
    }
    if (value && typeof value === 'object') {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key]))
        target[key] = {}
      mergeDeep(target[key], value)
      return
    }
    target[key] = value
  })
  return target
}

const syncFormValues = (meta) => {
  if (formRef.value?.setValues)
    formRef.value.setValues(meta || {})
}

const onSubmit = async (values = {}) => {
  state.loading = true
  const mergedMeta = mergeDeep(cloneMeta(state.meta), values || {})
  state.meta = mergedMeta
  await edgeFirebase.setUserMeta(mergedMeta)
  if (edgeGlobal?.edgeState)
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
  state.meta = cloneMeta(currentMeta.value)
  initializeDefaults(state.meta)
  syncFormValues(state.meta)
})

watch(currentMeta, async () => {
  state.meta = cloneMeta(currentMeta.value)
  initializeDefaults(state.meta)
  syncFormValues(state.meta)
  if (edgeGlobal?.edgeState)
    edgeGlobal.edgeState.changeTracker = {}
  state.loaded = false
  await nextTick()
  state.loaded = true
})
const route = useRoute()
const menuIcon = computed(() => {
  if (edgeGlobal?.iconFromMenu)
    return edgeGlobal.iconFromMenu(route)
  return null
})
</script>

<template>
  <Card class="w-full flex-1 bg-muted/50 mx-auto w-full border-none shadow-none pt-2">
    <edge-shad-form
      ref="formRef"
      :schema="resolvedSchema"
      :initial-values="state.meta"
      @submit="onSubmit"
    >
      <slot name="header">
        <edge-menu class="bg-secondary text-foreground rounded-none sticky top-0 py-3">
          <template #start>
            <slot name="header-start">
              <component :is="menuIcon" class="mr-2" />
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
              <edge-shad-button
                type="submit"
                :disabled="state.loading"
                class="text-white bg-slate-800 hover:bg-slate-400"
              >
                <Loader2 v-if="state.loading" class="w-4 h-4 mr-2 animate-spin" />
                Update Profile
              </edge-shad-button>
            </slot>
          </template>
        </edge-menu>
      </slot>
      <CardContent v-if="state.loaded" class="p-3 w-full overflow-y-auto scroll-area">
        <CardContent class="space-y-6">
          <div class="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
            <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Profile Details
            </div>
            <div class="flex flex-col gap-4 md:flex-row md:items-stretch">
              <div class="w-full md:w-[260px] self-stretch">
                <edge-image-picker
                  v-model="state.meta.profilephoto"
                  label="Profile Photo"
                  dialog-title="Select Profile Photo"
                  :site="'clearwater-hub-images'"
                  :default-tags="['Agents']"
                  height-class="h-full min-h-[180px]"
                />
              </div>
              <div class="flex-1 space-y-4">
                <edge-shad-input
                  v-model="state.meta.name"
                  name="name"
                  label="Name"
                />
                <edge-shad-input
                  v-model="state.meta.email"
                  name="email"
                  label="Email"
                  disabled
                  description="This field is tied to your username and can only be updated on the Account page."
                />
                <edge-shad-input
                  v-model="state.meta.phone"
                  name="phone"
                  label="Phone"
                  :mask-options="{ mask: '(###) ###-####' }"
                />
              </div>
            </div>
          </div>

          <div class="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
            <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Additional Details
            </div>
            <div class="grid grid-cols-12 gap-4">
              <div
                v-for="field in filteredMetaFields"
                :key="field.field"
                class="col-span-12 mb-3"
                :class="numColsToTailwind(field.cols)"
              >
                <edge-image-picker
                  v-if="field?.type === 'imagePicker'"
                  :model-value="getByPath(state.meta, field.field, '')"
                  :label="field?.label || 'Photo'"
                  :dialog-title="field?.dialogTitle || 'Select Image'"
                  :site="field?.site || 'clearwater-hub-images'"
                  :default-tags="field?.tags || []"
                  :height-class="field?.heightClass || 'h-[160px]'"
                  :disabled="field?.disabled || false"
                  @update:model-value="val => setByPath(state.meta, field.field, val)"
                />
                <p v-if="field?.type === 'imagePicker' && field?.disabled" class="mt-1 text-xs text-muted-foreground">
                  {{ getDisabledNote(field) }}
                </p>
                <div v-else-if="field?.type === 'richText'" class="profile-richtext">
                  <edge-shad-html
                    :model-value="getByPath(state.meta, field.field, '')"
                    :name="field.field"
                    :label="field?.label"
                    :disabled="field?.disabled || false"
                    :description="mergeDisabledNote(field?.description, field)"
                    :enabled-toggles="field?.enabledToggles || ['bold', 'italic', 'strike', 'bulletlist', 'orderedlist', 'underline']"
                    @update:model-value="val => setByPath(state.meta, field.field, val)"
                  />
                </div>
                <edge-shad-select-tags
                  v-else-if="field?.type === 'selectTags'"
                  :model-value="getByPath(state.meta, field.field, [])"
                  :name="field.field"
                  :label="field?.label"
                  :description="mergeDisabledNote(field?.description, field)"
                  :items="field?.items || []"
                  :item-title="field?.itemTitle || 'title'"
                  :item-value="field?.itemValue || 'name'"
                  :allow-additions="field?.allowAdditions || false"
                  :placeholder="field?.placeholder"
                  :disabled="field?.disabled || false"
                  @update:model-value="val => setByPath(state.meta, field.field, val)"
                />
                <div v-else-if="field?.type === 'boolean'" class="space-y-1 -mt-3">
                  <div class="text-sm font-medium leading-none opacity-0 select-none h-4">
                    {{ field?.label || '' }}
                  </div>
                  <edge-g-input
                    :model-value="getByPath(state.meta, field.field, false)"
                    :name="field.field"
                    :field-type="field?.type"
                    :label="field?.label"
                    parent-tracker-id="profile-settings"
                    :disable-tracking="true"
                    :disabled="field?.disabled || false"
                    @update:model-value="val => setByPath(state.meta, field.field, val)"
                  />
                  <p v-if="mergeDisabledNote(field?.hint, field)" class="text-xs text-muted-foreground">
                    {{ mergeDisabledNote(field?.hint, field) }}
                  </p>
                </div>
                <edge-g-input
                  v-else-if="field?.type === 'textarea'"
                  :model-value="getByPath(state.meta, field.field, '')"
                  :name="field.field"
                  :field-type="field?.type"
                  :label="field?.label"
                  parent-tracker-id="profile-settings"
                  :hint="mergeDisabledNote(field?.hint, field)"
                  :persistent-hint="Boolean(mergeDisabledNote(field?.hint, field))"
                  :disable-tracking="true"
                  :bindings="{ class: 'h-60' }"
                  :mask-options="field?.maskOptions"
                  :disabled="field?.disabled || false"
                  @update:model-value="val => setByPath(state.meta, field.field, val)"
                />
                <edge-shad-tags
                  v-else-if="field?.type === 'tags' || field?.type === 'commaTags'"
                  :model-value="getByPath(state.meta, field.field, '')"
                  :name="field.field"
                  :label="field?.label"
                  parent-tracker-id="profile-settings"
                  :description="mergeDisabledNote(field?.description || field?.hint, field)"
                  :disable-tracking="true"
                  :disabled="field?.disabled || false"
                  @update:model-value="val => setByPath(state.meta, field.field, val)"
                />
                <edge-shad-input
                  v-else
                  :model-value="getByPath(state.meta, field.field, '')"
                  :name="field.field"
                  :type="field?.type === 'number' ? 'number' : 'text'"
                  :label="field?.label"
                  :mask-options="field?.maskOptions"
                  :description="mergeDisabledNote(field?.description, field)"
                  :disabled="field?.disabled || false"
                  @update:model-value="val => setByPath(state.meta, field.field, val)"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </CardContent>
    </edge-shad-form>
  </Card>
</template>

<style lang="scss" scoped>
:deep(.profile-richtext .tiptap) {
  min-height: 220px;
  padding: 0.75rem 1rem;
}

:deep(.profile-richtext .tiptap p) {
  margin-top: 0;
  margin-bottom: 1rem;
}
</style>
