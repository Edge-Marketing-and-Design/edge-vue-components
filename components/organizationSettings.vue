<script setup>
import { computed, defineProps, inject, nextTick, onBeforeMount, reactive, watch } from 'vue'
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
  activeSectionKey: '',
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

const loadStateData = () => {
  state.data = edgeGlobal.dupObject(currentOrgData.value)
  for (const field of normalizedOrgFields.value) {
    if (edgeGlobal.objHas(state.data, field.field) === false) {
      if (field.type === 'section') {
        state.data[field.field] = {}
        for (const subField of field.fields) {
          if (edgeGlobal.objHas(state.data[field.field], subField.field) === false) {
            state.data[field.field][subField.field] = subField.value
          }
        }
      }
      else {
        state.data[field.field] = field.value
      }
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

const route = useRoute()
</script>

<template>
  <Card class="w-full flex-1 bg-muted/50 mx-auto w-full border-none shadow-none pt-2">
    <slot
      name="subscription"
      :subscribed-status="edgeGlobal.edgeState.subscribedStatus"
      :subscribe-options="props.subscribeOptions"
      :goto-subscription="gotoSubscription"
      :navigate-to-billing="navigateToBilling"
      :current-organization="edgeGlobal.edgeState.currentOrganization"
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
                  @click="gotoSubscription(`${option.stripeSubscriptionLink}?client_reference_id=${edgeGlobal.edgeState.currentOrganization}`)"
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

    <edge-shad-form
      :schema="props.formSchema"
      @submit="onSubmit"
    >
      <slot name="header">
        <edge-menu class="bg-secondary text-foreground rounded-none sticky top-0 py-6">
          <template #start>
            <slot name="header-start">
              <component :is="edgeGlobal.iconFromMenu(route)" class="mr-2" />
              <span class="capitalize">Organization Settings</span>
            </slot>
          </template>
          <template #center>
            <slot name="header-center">
              <div v-if="!props.hideSearch" class="w-full px-6" />
            </slot>
          </template>
          <template #end>
            <slot name="header-end">
              <div />
            </slot>
          </template>
        </edge-menu>
      </slot>
      <CardContent v-if="state.loaded" class="p-3 w-full  overflow-y-auto scroll-area">
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
          </template>
          <div v-if="props.sectionHeader" class="mt-3 mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {{ props.sectionHeader }}
          </div>
          <Tabs class="w-full" :model-value="state.activeSectionKey" @update:model-value="state.activeSectionKey = $event">
            <TabsList class="w-full mb-3 grid gap-1 border border-border bg-muted/40 p-1" :class="sectionTabGridClass">
              <TabsTrigger
                v-for="section in resolvedFieldSections"
                :key="`tabs-trigger-${section.key}`"
                :value="section.key"
                class="w-full text-foreground/70 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
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
              <p v-if="section.description" class="text-sm text-muted-foreground">
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
          </template>
          <div v-if="props.sectionHeader" class="mt-3 mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {{ props.sectionHeader }}
          </div>
          <Card v-for="section in resolvedFieldSections" :key="`cards-section-${section.key}`" class="mb-3">
            <CardHeader>
              <CardTitle>{{ section.label }}</CardTitle>
              <p v-if="section.description" class="text-sm text-muted-foreground">
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
