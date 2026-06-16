<script setup>
import { computed, defineProps, inject, nextTick, onBeforeMount, reactive, watch } from 'vue'
import { Loader2, Save } from 'lucide-vue-next'
import CardContent from '~/components/ui/card/CardContent.vue'

import { useToast } from '@/components/ui/toast/use-toast'
const props = defineProps({
  subscribeOptions: {
    type: Array,
    default: () => [],
  },
  orgFields: {
    type: [Array, Object],
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
  fieldSections: {
    type: Array,
    default: () => [],
  },
  sectionDisplay: {
    type: String,
    default: 'none', // none | cards | tabs
  },
  sectionHeader: {
    type: String,
    default: '',
  },
  renderUnsectionedFieldsWhenSectioned: {
    type: Boolean,
    default: false,
  },
  organizationId: {
    type: String,
    default: '',
  },
  organizationData: {
    type: Object,
    default: null,
  },
  showClose: {
    type: Boolean,
    default: false,
  },
})
const emit = defineEmits(['close'])
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
  activeSectionKey: '',
  activeSettingsTab: 'general',
})

const normalizedOrgFields = computed(() => {
  if (Array.isArray(props.orgFields))
    return props.orgFields
  if (props.orgFields && typeof props.orgFields === 'object')
    return Object.values(props.orgFields)
  return []
})

const fieldByName = computed(() => {
  const map = new Map()
  normalizedOrgFields.value.forEach((field, index) => {
    if (!field || typeof field !== 'object')
      return
    const key = String(field.field || `field-${index}`).trim()
    if (!key)
      return
    map.set(key, field)
  })
  return map
})

const resolvedFieldSections = computed(() => {
  const sections = Array.isArray(props.fieldSections) ? props.fieldSections : []
  if (!sections.length)
    return []
  return sections
    .map((section, index) => {
      const key = String(section?.key || section?.value || section?.label || `section-${index}`).trim()
      const fieldDefs = Array.isArray(section?.fields) ? section.fields : []
      const fields = fieldDefs
        .map((entry) => {
          if (typeof entry === 'string')
            return fieldByName.value.get(entry)
          if (entry && typeof entry === 'object')
            return entry
          return null
        })
        .filter(Boolean)
      if (!key || !fields.length)
        return null
      return {
        key,
        label: section?.label || key,
        description: section?.description || '',
        fields,
      }
    })
    .filter(Boolean)
})

const useSectionCards = computed(() => props.sectionDisplay === 'cards' && resolvedFieldSections.value.length > 0)
const useSectionTabs = computed(() => props.sectionDisplay === 'tabs' && resolvedFieldSections.value.length > 0)
const sectionFieldNames = computed(() => {
  const names = new Set()
  resolvedFieldSections.value.forEach((section) => {
    section.fields.forEach((field) => {
      const key = String(field?.field || '').trim()
      if (key)
        names.add(key)
    })
  })
  return names
})
const unsectionedOrgFields = computed(() => {
  return normalizedOrgFields.value.filter((field) => {
    const key = String(field?.field || '').trim()
    if (!key)
      return false
    return !sectionFieldNames.value.has(key)
  })
})
const shouldRenderUnsectionedBeforeSections = computed(() =>
  props.renderUnsectionedFieldsWhenSectioned
  && (useSectionTabs.value || useSectionCards.value)
  && unsectionedOrgFields.value.length > 0,
)
const sectionTabGridClass = computed(() => {
  const count = Math.min(Math.max(resolvedFieldSections.value.length, 1), 6)
  const map = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-6',
  }
  return map[count] || 'grid-cols-1'
})

const targetOrganizationId = computed(() =>
  String(props.organizationId || edgeGlobal.edgeState.currentOrganization || '').trim(),
)
const targetOrganizationDocPath = computed(() =>
  targetOrganizationId.value ? `organizations/${targetOrganizationId.value}` : edgeGlobal.edgeState.organizationDocPath,
)
const orgSettingsTrackerId = computed(() =>
  targetOrganizationId.value ? `org-settings-${targetOrganizationId.value}` : 'org-settings',
)

const onSubmit = async () => {
  state.loading = true
  state.showSnack = false
  const result = await edgeFirebase.changeDoc('organizations', targetOrganizationId.value, state.data)
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
  if (edgeGlobal.objHas(edgeFirebase.data, targetOrganizationDocPath.value) === false)
    return props.organizationData || ''
  return edgeFirebase.data[targetOrganizationDocPath.value]
})

const loadStateData = () => {
  state.data = edgeGlobal.dupObject(currentOrgData.value)
  for (const field of normalizedOrgFields.value) {
    if (field.type === 'section') {
      if (edgeGlobal.objHas(state.data, field.field) === false)
        state.data[field.field] = {}
      for (const subField of field.fields) {
        if (edgeGlobal.objHas(state.data[field.field], subField.field) === false)
          state.data[field.field][subField.field] = subField.value
      }
    }
    else if (edgeGlobal.objHas(state.data, field.field) === false) {
      state.data[field.field] = field.value
    }
  }
}

onBeforeMount(() => {
  loadStateData()
  if (!state.activeSectionKey && resolvedFieldSections.value.length > 0)
    state.activeSectionKey = resolvedFieldSections.value[0].key
  state.loaded = true
})
watch(currentOrgData, async () => {
  edgeGlobal.edgeState.changeTracker = {}
  loadStateData()
  state.loaded = false
  await nextTick()
  state.loaded = true
})

watch(targetOrganizationId, () => {
  edgeGlobal.edgeState.changeTracker = {}
})

watch(
  resolvedFieldSections,
  (sections) => {
    const keys = sections.map(section => section.key)
    if (!keys.length) {
      state.activeSectionKey = ''
      return
    }
    if (!keys.includes(state.activeSectionKey))
      state.activeSectionKey = keys[0]
  },
  { immediate: true },
)

const navigateToBilling = async () => {
  state.loading = true
  const billingLink = await edgeFirebase.runFunction('stripe-redirectToBilling', {})
  window.location.href = billingLink.data.url
  state.loading = false
}

const gotoSubscription = async (url) => {
  state.loading = true
  window.location.href = url
  state.loading = false
}

const organizationName = computed(() => String(currentOrgData.value?.name || '').trim() || 'Organization Settings')
</script>

<template>
  <Card class="mx-auto flex h-full w-full flex-1 flex-col overflow-hidden border-none bg-slate-100 pt-0 shadow-none dark:bg-slate-950">
    <edge-shad-form
      :schema="props.formSchema"
      class="flex min-h-0 flex-1 flex-col"
      @submit="onSubmit"
    >
      <slot name="header">
        <div class="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div class="px-6 py-6">
            <div class="text-sm text-slate-500 dark:text-slate-400">
              Account <span class="mx-2 text-slate-300 dark:text-slate-700">/</span>
              <span class="font-medium text-slate-900 dark:text-slate-100">Organization Settings</span>
            </div>
            <div class="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div class="min-w-0">
                <h1 class="line-clamp-2 max-w-5xl text-3xl font-bold leading-tight text-slate-950 dark:text-slate-50 xl:text-4xl">
                  {{ organizationName }}
                </h1>
                <div class="mt-3 flex flex-wrap items-center gap-3 text-base text-slate-500 dark:text-slate-400">
                  <span>Organization settings</span>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <slot
                  name="header-actions"
                  :current-organization="targetOrganizationId"
                  :loading="state.loading"
                />
                <edge-shad-button
                  v-if="props.showClose"
                  variant="outline"
                  class="h-10 border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                  :disabled="state.loading"
                  @click.prevent="emit('close')"
                >
                  Close
                </edge-shad-button>
                <edge-shad-button
                  type="submit"
                  :disabled="state.loading"
                  class="h-10 bg-slate-900 px-4 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                >
                  <Loader2 v-if="state.loading" class="mr-2 h-4 w-4 animate-spin" />
                  <Save v-else class="mr-2 h-4 w-4" />
                  Save
                </edge-shad-button>
              </div>
            </div>
          </div>
        </div>
      </slot>
      <CardContent v-if="state.loaded" class="scroll-area min-h-0 w-full flex-1 overflow-y-auto bg-slate-100 p-6 dark:bg-slate-950">
        <Tabs class="flex min-h-full w-full flex-col" :model-value="state.activeSettingsTab" @update:model-value="state.activeSettingsTab = $event">
          <TabsList class="mb-4 grid w-full grid-cols-2 border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
            <TabsTrigger value="general" class="text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:data-[state=active]:bg-slate-100 dark:data-[state=active]:text-slate-900">
              General Settings
            </TabsTrigger>
            <TabsTrigger value="emailTemplates" class="text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:data-[state=active]:bg-slate-100 dark:data-[state=active]:text-slate-900">
              Email Templates
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general" class="mt-0 min-h-0 flex-1">
            <div class="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <slot
                name="subscription"
                :subscribed-status="edgeGlobal.edgeState.subscribedStatus"
                :subscribe-options="props.subscribeOptions"
                :goto-subscription="gotoSubscription"
                :navigate-to-billing="navigateToBilling"
                :current-organization="targetOrganizationId"
              >
                <Alert v-if="edgeGlobal.edgeState.subscribedStatus && props.subscribeOptions.length > 0" class="mt-0" :class="edgeGlobal.edgeState.subscribedStatus.color">
                  <component :is="edgeGlobal.edgeState.subscribedStatus.icon" />
                  <AlertTitle>
                    {{ edgeGlobal.edgeState.subscribedStatus.status }}
                  </AlertTitle>
                  <AlertDescription>
                    {{ edgeGlobal.edgeState.subscribedStatus.description }}
                    <template v-if="!edgeGlobal.edgeState.subscribedStatus.isSubscribed">
                      <div class="text-center w-full mb-4">
                        <slot name="subscribeTitle">
                          <span class="text-2xl">Subscribe now with 7 day free trial!</span>
                        </slot>
                      </div>
                      <slot name="subscribeOptions">
                        <div class="flex justify-center space-x-4">
                          <edge-shad-button
                            v-for="option in props.subscribeOptions"
                            :key="option.buttonText"
                            class="text-white  w-100 bg-slate-800 hover:bg-slate-400"
                            @click="gotoSubscription(`${option.stripeSubscriptionLink}?client_reference_id=${targetOrganizationId}`)"
                          >
                            {{ option.buttonText }}
                          </edge-shad-button>
                        </div>
                      </slot>
                    </template>
                    <div v-else class="flex flex-col sm:flex-row">
                      <div>
                        <edge-shad-button
                          class="text-white  w-100 bg-slate-800 hover:bg-slate-400"
                          @click="navigateToBilling"
                        >
                          Manage Subscription
                        </edge-shad-button>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              </slot>
              <template v-if="useSectionTabs">
                <template v-if="shouldRenderUnsectionedBeforeSections">
                  <template v-for="field in unsectionedOrgFields" :key="`unsectioned-tabs-${field.field}`">
                    <Card v-if="field.type === 'section'" class="mb-2">
                      <CardHeader>
                        <CardTitle>
                          {{ field.label }}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div class="grid gap-2">
                          <template v-for="subField in field.fields" :key="subField.field">
                            <edge-g-input
                              v-model="state.data[field.field][subField.field]"
                              :name="`${field.field}.${subField.field}`"
                              :label="subField.label"
                              :field-type="subField.type"
                              :hint="subField.hint"
                              persistent-hint
                            />
                          </template>
                        </div>
                      </CardContent>
                    </Card>
                    <edge-g-input
                      v-else-if="edgeGlobal.objHas(field, 'bindings')"
                      v-model="state.data[field.field]"
                      :name="field.field"
                      v-bind="field.bindings"
                      :parent-tracker-id="`${orgSettingsTrackerId}-${field.field}`"
                    />
                    <edge-g-input
                      v-else
                      v-model="state.data[field.field]"
                      :name="field.field"
                      :field-type="field.type"
                      :label="field.label"
                      :parent-tracker-id="orgSettingsTrackerId"
                      :hint="field.hint"
                      persistent-hint
                    />
                  </template>
                </template>
                <div v-if="props.sectionHeader" class="mt-3 mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  {{ props.sectionHeader }}
                </div>
                <Tabs class="w-full" :model-value="state.activeSectionKey" @update:model-value="state.activeSectionKey = $event">
                  <TabsList class="w-full mb-3 grid gap-1 border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800" :class="sectionTabGridClass">
                    <TabsTrigger
                      v-for="section in resolvedFieldSections"
                      :key="`tabs-trigger-${section.key}`"
                      :value="section.key"
                      class="w-full text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm dark:text-slate-300 dark:data-[state=active]:bg-slate-100 dark:data-[state=active]:text-slate-900"
                    >
                      {{ section.label }}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent
                    v-for="section in resolvedFieldSections"
                    :key="`tabs-content-${section.key}`"
                    :value="section.key"
                    class="space-y-2"
                  >
                    <p v-if="section.description" class="text-sm text-slate-500 dark:text-slate-400">
                      {{ section.description }}
                    </p>
                    <template v-for="field in section.fields" :key="`section-field-${section.key}-${field.field}`">
                      <Card v-if="field.type === 'section'" class="mb-2">
                        <CardHeader>
                          <CardTitle>
                            {{ field.label }}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div class="grid gap-2">
                            <template v-for="subField in field.fields" :key="subField.field">
                              <edge-g-input
                                v-model="state.data[field.field][subField.field]"
                                :name="`${field.field}.${subField.field}`"
                                :label="subField.label"
                                :field-type="subField.type"
                                :hint="subField.hint"
                                persistent-hint
                              />
                            </template>
                          </div>
                        </CardContent>
                      </Card>
                      <edge-g-input
                        v-else-if="edgeGlobal.objHas(field, 'bindings')"
                        v-model="state.data[field.field]"
                        :name="field.field"
                        v-bind="field.bindings"
                        :parent-tracker-id="`${orgSettingsTrackerId}-${field.field}`"
                      />
                      <edge-g-input
                        v-else
                        v-model="state.data[field.field]"
                        :name="field.field"
                        :field-type="field.type"
                        :label="field.label"
                        :parent-tracker-id="orgSettingsTrackerId"
                        :hint="field.hint"
                        persistent-hint
                      />
                    </template>
                  </TabsContent>
                </Tabs>
              </template>
              <template v-else-if="useSectionCards">
                <template v-if="shouldRenderUnsectionedBeforeSections">
                  <template v-for="field in unsectionedOrgFields" :key="`unsectioned-cards-${field.field}`">
                    <Card v-if="field.type === 'section'" class="mb-2">
                      <CardHeader>
                        <CardTitle>
                          {{ field.label }}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div class="grid gap-2">
                          <template v-for="subField in field.fields" :key="subField.field">
                            <edge-g-input
                              v-model="state.data[field.field][subField.field]"
                              :name="`${field.field}.${subField.field}`"
                              :label="subField.label"
                              :field-type="subField.type"
                              :hint="subField.hint"
                              persistent-hint
                            />
                          </template>
                        </div>
                      </CardContent>
                    </Card>
                    <edge-g-input
                      v-else-if="edgeGlobal.objHas(field, 'bindings')"
                      v-model="state.data[field.field]"
                      :name="field.field"
                      v-bind="field.bindings"
                      :parent-tracker-id="`${orgSettingsTrackerId}-${field.field}`"
                    />
                    <edge-g-input
                      v-else
                      v-model="state.data[field.field]"
                      :name="field.field"
                      :field-type="field.type"
                      :label="field.label"
                      :parent-tracker-id="orgSettingsTrackerId"
                      :hint="field.hint"
                      persistent-hint
                    />
                  </template>
                </template>
                <div v-if="props.sectionHeader" class="mt-3 mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  {{ props.sectionHeader }}
                </div>
                <Card v-for="section in resolvedFieldSections" :key="`cards-section-${section.key}`" class="mb-3 border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                  <CardHeader>
                    <CardTitle>{{ section.label }}</CardTitle>
                    <p v-if="section.description" class="text-sm text-slate-500 dark:text-slate-400">
                      {{ section.description }}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <template v-for="field in section.fields" :key="`section-field-${section.key}-${field.field}`">
                      <Card v-if="field.type === 'section'" class="mb-2">
                        <CardHeader>
                          <CardTitle>
                            {{ field.label }}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div class="grid gap-2">
                            <template v-for="subField in field.fields" :key="subField.field">
                              <edge-g-input
                                v-model="state.data[field.field][subField.field]"
                                :name="`${field.field}.${subField.field}`"
                                :label="subField.label"
                                :field-type="subField.type"
                                :hint="subField.hint"
                                persistent-hint
                              />
                            </template>
                          </div>
                        </CardContent>
                      </Card>
                      <edge-g-input
                        v-else-if="edgeGlobal.objHas(field, 'bindings')"
                        v-model="state.data[field.field]"
                        :name="field.field"
                        v-bind="field.bindings"
                        :parent-tracker-id="`${orgSettingsTrackerId}-${field.field}`"
                      />
                      <edge-g-input
                        v-else
                        v-model="state.data[field.field]"
                        :name="field.field"
                        :field-type="field.type"
                        :label="field.label"
                        :parent-tracker-id="orgSettingsTrackerId"
                        :hint="field.hint"
                        persistent-hint
                      />
                    </template>
                  </CardContent>
                </Card>
              </template>
              <template v-for="field in normalizedOrgFields" v-else :key="field.field">
                <Card v-if="field.type === 'section'" class="mb-2">
                  <CardHeader>
                    <CardTitle>
                      {{ field.label }}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div class="grid gap-2">
                      <template v-for="subField in field.fields" :key="subField.field">
                        <edge-g-input
                          v-model="state.data[field.field][subField.field]"
                          :name="`${field.field}.${subField.field}`"
                          :label="subField.label"
                          :field-type="subField.type"
                          :hint="subField.hint"
                          persistent-hint
                        />
                      </template>
                    </div>
                  </CardContent>
                </Card>
                <edge-g-input
                  v-if="edgeGlobal.objHas(field, 'bindings')"
                  v-model="state.data[field.field]"
                  :name="field.field"
                  v-bind="field.bindings"
                  :parent-tracker-id="`${orgSettingsTrackerId}-${field.field}`"
                />
                <edge-g-input
                  v-else
                  v-model="state.data[field.field]"
                  :name="field.field"
                  :field-type="field.type"
                  :label="field.label"
                  :parent-tracker-id="orgSettingsTrackerId"
                  :hint="field.hint"
                  persistent-hint
                />
              </template>
              <span class="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                ID: {{ targetOrganizationId }}
                <edge-clipboard-button :text="targetOrganizationId" />
              </span>
              <Alert v-if="state.showSnack" class="bg-success mt-4 py-2 flex">
                <div>
                  {{ state.successMessage }}
                </div>
                <div class="grow text-right">
                  <edge-shad-button

                    class="mx-2 h-6 bg-slate-900 text-xs text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"

                    @click="state.showSnack = false"
                  >
                    Close
                  </edge-shad-button>
                </div>
              </Alert>
            </div>
          </TabsContent>
          <TabsContent value="emailTemplates" class="mt-0 min-h-0 flex-1">
            <edge-email-templates
              :organization-id="targetOrganizationId"
              protected-template-ids="lead-notification"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </edge-shad-form>
  </Card>
</template>

<style lang="scss" scoped>

</style>
