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

const organizationCount = computed(() => edgeGlobal.edgeState.organizations?.length || 0)

watch(roles, async () => {
  await edgeGlobal.getOrganizations(edgeFirebase)
  state.loaded = false
  await nextTick()
  state.loaded = true
})
</script>

<template>
  <Card class="mx-auto w-full flex-1 border-none bg-slate-100 pt-0 shadow-none dark:bg-slate-950">
    <slot name="header">
      <div class="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div class="px-6 py-6">
          <div class="text-sm text-slate-500 dark:text-slate-400">
            Account <span class="mx-2 text-slate-300 dark:text-slate-700">/</span>
            <span class="font-medium text-slate-900 dark:text-slate-100">My Organizations</span>
          </div>
          <div class="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0">
              <h1 class="line-clamp-2 max-w-5xl text-3xl font-bold leading-tight text-slate-950 dark:text-slate-50 xl:text-4xl">
                My Organizations
              </h1>
              <div class="mt-3 flex flex-wrap items-center gap-3 text-base text-slate-500 dark:text-slate-400">
                <span>{{ organizationCount }} organization{{ organizationCount === 1 ? '' : 's' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </slot>
    <CardContent v-if="state.loaded" class="scroll-area w-full overflow-y-auto bg-slate-100 p-6 dark:bg-slate-950">
      <div class="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Organizations
        </div>
        <edge-g-input
          v-if="state.loaded"
          v-model="edgeGlobal.edgeState.organizations"
          name="organizations"
          :disable-tracking="true"
          field-type="objectList"
          sub-field-type="my-orgs"
          parent-tracker-id="myOrgs"
          :pass-through-props="props.registrationCode"
        />
      </div>
    </CardContent>
  </Card>
</template>

<style lang="scss" scoped>

</style>
