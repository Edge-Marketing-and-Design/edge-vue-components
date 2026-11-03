<script setup>
import { Map, Plus, Trash2 } from 'lucide-vue-next'
import { createSitemapSettings, validateSitemapSettings } from '../../lib/cmsSitemapSettings'

const props = defineProps({ modelValue: { type: Object, default: null } })
const emit = defineEmits(['update:modelValue'])
const config = computed(() => ({ ...createSitemapSettings(), ...props.modelValue }))
const errors = computed(() => validateSitemapSettings(props.modelValue))
const scopeItems = [{ value: 'org', label: 'Organization records' }, { value: 'site', label: 'This site’s records' }]
const filterItems = ['All values', 'Text', 'Boolean', 'Number'].map(value => ({ value, label: value }))
const booleanItems = [{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }]
const update = changes => emit('update:modelValue', { ...config.value, ...changes })
const updateRow = (index, changes) => update({ collections: config.value.collections.map((row, i) => i === index ? { ...row, ...changes } : row) })
const addRow = () => update({ collections: [...config.value.collections, { collection: '', fileName: '', routePrefix: '', pathField: '', scope: 'org', indexField: 'name' }] })
const removeRow = index => update({ collections: config.value.collections.filter((_, i) => i !== index) })
const addApi = () => update({ apis: [...config.value.apis, { fileName: '', sourceUrl: '' }] })
const updateApi = (index, changes) => update({ apis: config.value.apis.map((row, i) => i === index ? { ...row, ...changes } : row) })
const removeApi = index => update({ apis: config.value.apis.filter((_, i) => i !== index) })
const filterType = row => row.indexValue === undefined ? 'All values' : ({ string: 'Text', boolean: 'Boolean', number: 'Number' }[typeof row.indexValue] || 'Text')
const changeFilterType = (index, type) => updateRow(index, { indexValue: ({ Text: '', Boolean: true, Number: 0 })[type] })
const updateFilterValue = (index, row, value) => updateRow(index, { indexValue: filterType(row) === 'Number' ? (String(value).trim() ? Number(value) : Number.NaN) : value })
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-start gap-3">
      <Map class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div>
        <h3 class="font-semibold text-foreground">Sitemaps for this site</h3>
        <p class="mt-1 text-sm text-muted-foreground">Define additional sitemap sources. Ordinary page URLs are handled automatically.</p>
      </div>
    </div>
    <p class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      Saved with this site's draft settings and included when you publish settings. The public renderer still needs support for this configuration before it affects sitemap output.
    </p>
    <div v-if="errors.length" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
      <p class="font-medium">Complete these settings before saving:</p>
      <ul class="mt-1 list-disc space-y-1 pl-5"><li v-for="error in errors" :key="error">{{ error }}</li></ul>
    </div>
    <section class="space-y-3" aria-label="Collection sitemaps">
      <div class="flex items-center justify-between gap-3">
        <h4 class="text-sm font-semibold">Collection sitemaps <span class="text-muted-foreground">({{ config.collections.length }})</span></h4>
        <edge-shad-button type="button" variant="outline" size="sm" class="gap-1.5" @click="addRow"><Plus class="h-3.5 w-3.5" aria-hidden="true" />Add collection</edge-shad-button>
      </div>
      <p v-if="!config.collections.length" class="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No collection sitemaps configured.</p>
      <div v-for="(row, index) in config.collections" :key="index" class="space-y-3 rounded-lg border border-border p-4">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium">{{ row.collection || `Collection ${index + 1}` }}</span>
          <edge-shad-button type="button" variant="ghost" size="sm" class="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" :aria-label="`Remove collection sitemap ${index + 1}`" @click="removeRow(index)"><Trash2 class="h-4 w-4" /></edge-shad-button>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <edge-shad-input :model-value="row.collection" :name="`sitemap-collection-${index}`" label="Collection" placeholder="offices" @update:model-value="value => updateRow(index, { collection: value })" />
          <edge-shad-input :model-value="row.fileName" :name="`sitemap-file-${index}`" label="XML filename" placeholder="offices_sitemap.xml" @update:model-value="value => updateRow(index, { fileName: value })" />
          <edge-shad-input :model-value="row.routePrefix" :name="`sitemap-prefix-${index}`" label="URL prefix" placeholder="offices" @update:model-value="value => updateRow(index, { routePrefix: value })" />
          <edge-shad-input :model-value="row.pathField" :name="`sitemap-path-${index}`" label="Stored path field (optional)" placeholder="slug" @update:model-value="value => updateRow(index, { pathField: value })" />
        </div>
        <p class="text-xs text-muted-foreground">Without a path field, URLs use the record's name as a slug. A relative stored path follows the prefix; a path starting with / is rooted at the site.</p>
        <edge-shad-select :model-value="row.scope || 'org'" :name="`sitemap-scope-${index}`" label="Record scope" :items="scopeItems" item-title="label" item-value="value" @update:model-value="value => updateRow(index, { scope: value })" />
        <p class="text-xs text-muted-foreground">Choose site records for published posts. Collections such as offices use organization records. This sitemap is configured only for this site.</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <edge-shad-input :model-value="row.indexField" :name="`sitemap-index-${index}`" label="Index field" placeholder="name" @update:model-value="value => updateRow(index, { indexField: value })" />
          <edge-shad-select :model-value="filterType(row)" :name="`sitemap-filter-type-${index}`" label="Index filter" :items="filterItems" item-title="label" item-value="value" @update:model-value="value => changeFilterType(index, value)" />
        </div>
        <edge-shad-select v-if="filterType(row) === 'Boolean'" :model-value="String(row.indexValue)" :name="`sitemap-filter-${index}`" label="Index value" :items="booleanItems" item-title="label" item-value="value" @update:model-value="value => updateRow(index, { indexValue: value === 'true' })" />
        <edge-shad-input v-else-if="filterType(row) !== 'All values'" :model-value="String(row.indexValue ?? '')" :name="`sitemap-filter-${index}`" label="Index value" :type="filterType(row) === 'Number' ? 'number' : 'text'" @update:model-value="value => updateFilterValue(index, row, value)" />
        <p v-if="row.fileName" class="break-all text-xs text-muted-foreground">Output: /sitemaps/{{ row.fileName }}</p>
      </div>
    </section>
    <section class="space-y-3" aria-label="API sitemaps">
      <div class="flex items-center justify-between gap-3">
        <h4 class="text-sm font-semibold">
          API sitemaps <span class="text-muted-foreground">({{ config.apis.length }})</span>
        </h4>
        <edge-shad-button type="button" variant="outline" size="sm" class="gap-1.5" @click="addApi">
          <Plus class="h-3.5 w-3.5" aria-hidden="true" />
          Add API
        </edge-shad-button>
      </div>
      <p class="text-xs text-muted-foreground">Add an API URL for each source. Include filters directly in its query string.</p>
      <p v-if="!config.apis.length" class="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No API sitemaps configured.
      </p>
      <div v-for="(api, index) in config.apis" :key="index" class="space-y-3 rounded-lg border border-border p-4">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium">{{ api.fileName || `API ${index + 1}` }}</span>
          <edge-shad-button type="button" variant="ghost" size="sm" class="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" :aria-label="`Remove API sitemap ${index + 1}`" @click="removeApi(index)">
            <Trash2 class="h-4 w-4" aria-hidden="true" />
          </edge-shad-button>
        </div>
        <edge-shad-input
          :model-value="api.fileName"
          :name="`sitemap-api-file-${index}`"
          label="XML filename"
          placeholder="products_sitemap.xml"
          @update:model-value="value => updateApi(index, { fileName: value })"
        />
        <edge-shad-input
          :model-value="api.sourceUrl"
          :name="`sitemap-api-source-${index}`"
          label="API URL"
          placeholder="https://api.example.com/sitemap?category=products&page=1"
          @update:model-value="value => updateApi(index, { sourceUrl: value })"
        />
        <p v-if="api.fileName" class="break-all text-xs text-muted-foreground">Output name: {{ api.fileName }}</p>
      </div>
      <p class="text-xs text-muted-foreground">Each entry names a sitemap source. Pagination will be handled by the frontend integration; do not add a separate entry for every API page.</p>
    </section>
  </div>
</template>
