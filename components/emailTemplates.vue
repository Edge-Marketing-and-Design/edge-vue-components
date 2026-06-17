<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import { BookOpen, Eye, FileText, Pencil, Plus, Save, Trash2 } from 'lucide-vue-next'

const props = defineProps({
  organizationId: {
    type: String,
    default: '',
  },
  protectedTemplateIds: {
    type: [Array, String],
    default: () => [],
  },
  systemTemplates: {
    type: Array,
    default: () => [],
  },
})

const edgeFirebase = inject('edgeFirebase')

const DEFAULT_TEMPLATE_ID = 'default'
const DEFAULT_EXCLUDED_FIELDS = ['siteId', 'pageId', 'blockId', 'emailTemplate']

const sampleData = {
  subject: 'New Contact Form Submission',
  name: 'John Smith',
  email: 'john@example.com',
  phone: '(555) 123-4567',
  message: 'I would like more information.',
  services: [
    { name: 'Website Design', budget: '$5,000' },
    { name: 'Email Marketing', budget: '$1,500' },
  ],
  siteId: 'sample-site',
  pageId: 'contact',
  blockId: 'contact-form',
  emailTemplate: 'default',
}

const defaultTemplate = {
  docId: DEFAULT_TEMPLATE_ID,
  name: 'Default',
  subject: '{{subject}}',
  html: [
    '<div style="margin:0; padding:24px; background:#f8fafc; font-family:Arial,Helvetica,sans-serif; color:#111827;">',
    '  <div style="max-width:680px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">',
    '    <div style="background:#111827; color:#ffffff; padding:20px 24px;">',
    '      <h1 style="margin:0; font-size:20px; line-height:1.35;">{{subject}}</h1>',
    '    </div>',
    '    <div style="padding:24px;">',
    '      <p style="margin:0 0 18px; color:#4b5563; font-size:14px; line-height:1.6;">A new submission was received.</p>',
    '      {{{all_fields_html}}}',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n'),
  text: '{{subject}}\n\n{{all_fields}}',
  excludedFields: DEFAULT_EXCLUDED_FIELDS,
  sampleData,
  systemDefault: true,
}

const helpExamples = {
  field: '{{name}}',
  nested: '{{contact.email}}',
  array: '{{#services}}\n  <p>{{name}} - {{budget}}</p>\n{{/services}}',
  emptyArray: '{{^services}}\n  <p>No services selected.</p>\n{{/services}}',
  allFieldsHtml: '{{{all_fields_html}}}',
  allFieldsText: '{{all_fields}}',
}

const state = reactive({
  loaded: false,
  loading: false,
  selectedTemplateId: DEFAULT_TEMPLATE_ID,
  workingTemplate: edgeGlobal.dupObject(defaultTemplate),
  previewMode: true,
  deleteDialog: false,
  helpOpen: false,
  editorTab: 'settings',
  previewTab: 'html',
  sampleDataText: JSON.stringify(sampleData, null, 2),
})

const organizationId = computed(() =>
  String(props.organizationId || edgeGlobal.edgeState.currentOrganization || '').trim(),
)
const collectionPath = computed(() =>
  organizationId.value ? `organizations/${organizationId.value}/emailTemplates` : '',
)
const collectionData = computed(() =>
  collectionPath.value ? (edgeFirebase.data?.[collectionPath.value] || {}) : {},
)
const templates = computed(() => {
  const items = Object.entries(collectionData.value)
    .map(([docId, doc]) => ({ ...doc, docId: doc?.docId || docId }))
    .sort((a, b) => {
      if (a.docId === DEFAULT_TEMPLATE_ID)
        return -1
      if (b.docId === DEFAULT_TEMPLATE_ID)
        return 1
      return String(a.name || a.docId).localeCompare(String(b.name || b.docId))
    })
  return items
})
const selectedTemplate = computed(() =>
  templates.value.find(template => template.docId === state.selectedTemplateId) || templates.value[0] || null,
)
const isDefaultTemplate = computed(() => state.workingTemplate?.docId === DEFAULT_TEMPLATE_ID)
const protectedTemplateIds = computed(() => {
  const configuredIds = Array.isArray(props.protectedTemplateIds)
    ? props.protectedTemplateIds
    : [props.protectedTemplateIds]
  return new Set([
    DEFAULT_TEMPLATE_ID,
    ...configuredIds,
  ].map(id => String(id || '').trim()).filter(Boolean))
})
const isProtectedTemplate = computed(() =>
  protectedTemplateIds.value.has(String(state.workingTemplate?.docId || '').trim()),
)
const activeEditorValue = computed({
  get: () => state.editorTab === 'text' ? state.workingTemplate.text : state.workingTemplate.html,
  set: (value) => {
    if (state.editorTab === 'text')
      state.workingTemplate.text = value
    else
      state.workingTemplate.html = value
  },
})
const activeEditorLanguage = computed(() => state.editorTab === 'text' ? 'plaintext' : 'html')
const previewSampleData = computed(() => {
  try {
    const parsed = JSON.parse(state.sampleDataText || '{}')
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : sampleData
  }
  catch {
    return sampleData
  }
})

const sampleDataTextForTemplate = template =>
  JSON.stringify(template?.sampleData || sampleData, null, 2)

const applyWorkingTemplate = (template) => {
  const normalizedTemplate = normalizeTemplateDoc(template)
  state.workingTemplate = normalizedTemplate
  state.sampleDataText = sampleDataTextForTemplate(normalizedTemplate)
}

const openPreview = () => {
  state.previewMode = true
  state.previewTab = 'html'
}

const closePreview = () => {
  state.previewMode = false
}

const normalizeTemplateDoc = (doc = {}) => ({
  ...edgeGlobal.dupObject(defaultTemplate),
  ...edgeGlobal.dupObject(doc || {}),
  docId: doc?.docId || DEFAULT_TEMPLATE_ID,
  excludedFields: Array.isArray(doc?.excludedFields) ? doc.excludedFields : DEFAULT_EXCLUDED_FIELDS,
  sampleData: doc?.sampleData && typeof doc.sampleData === 'object' && !Array.isArray(doc.sampleData)
    ? doc.sampleData
    : sampleData,
  systemDefault: doc?.docId === DEFAULT_TEMPLATE_ID || doc?.systemDefault === true,
})

const humanizeFieldName = value =>
  String(value || '')
    .replace(/\[(\d+)\]/g, ' $1')
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase())

const escapeHtml = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const formatValue = (value) => {
  if (value === undefined || value === null)
    return ''
  if (typeof value === 'string')
    return value
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

const flattenFields = (value, prefix = '') => {
  if (value === undefined || value === null)
    return []
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenFields(item, `${prefix}[${index}]`))
  }
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      flattenFields(item, prefix ? `${prefix}.${key}` : key),
    )
  }
  return [{ key: prefix, value }]
}

const normalizeTemplateValue = (value) => {
  if (Array.isArray(value))
    return value.map(item => normalizeTemplateValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeTemplateValue(item)]),
    )
  }
  if (typeof value !== 'string')
    return value

  const trimmed = value.trim()
  if (!trimmed)
    return value

  try {
    return normalizeTemplateValue(JSON.parse(trimmed))
  }
  catch {
    return value
  }
}

const normalizeTemplateData = (data = {}) => {
  if (!data || typeof data !== 'object')
    return {}
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, normalizeTemplateValue(value)]),
  )
}

const setByPath = (target, path, value) => {
  const parts = String(path || '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  if (!parts.length)
    return
  let current = target
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1
    if (isLast) {
      current[part] = value
      return
    }
    if (!current[part] || typeof current[part] !== 'object')
      current[part] = /^\d+$/.test(parts[index + 1]) ? [] : {}
    current = current[part]
  })
}

const labelForField = (key) => {
  return humanizeFieldName(key)
}

const entryIsExcluded = (key, template) => {
  const excluded = new Set(template.excludedFields || [])
  const lastSegment = String(key || '').split('.').pop()
  return excluded.has(key) || excluded.has(lastSegment)
}

const buildTemplateContext = (data, template) => {
  const context = {}
  const normalizedData = normalizeTemplateData(data)
  Object.entries(normalizedData).forEach(([key, value]) => {
    context[key] = value
    setByPath(context, key, value)
  })

  const entries = flattenFields(normalizedData)
    .filter(entry => entry.key && !entryIsExcluded(entry.key, template))
    .map(entry => ({
      key: entry.key,
      label: labelForField(entry.key),
      value: entry.value,
    }))

  context.entries = entries
  context.all_fields = entries.length
    ? entries.map(entry => `${entry.label}: ${formatValue(entry.value)}`).join('\n')
    : '(no fields provided)'
  context.all_fields_html = entries.length
    ? [
        '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb;">',
        ...entries.map((entry, index) => [
          `<tr style="background:${index % 2 === 0 ? '#ffffff' : '#f9fafb'};">`,
          `<td style="width:36%; padding:10px 12px; border-bottom:1px solid #e5e7eb; font-weight:700; color:#374151; vertical-align:top;">${escapeHtml(entry.label)}</td>`,
          `<td style="padding:10px 12px; border-bottom:1px solid #e5e7eb; color:#111827; white-space:pre-wrap;">${escapeHtml(formatValue(entry.value))}</td>`,
          '</tr>',
        ].join('')),
        '</table>',
      ].join('')
    : '<p style="margin:0; color:#6b7280;">No fields were provided.</p>'
  return context
}

const tokenizeTemplatePath = path =>
  String(path || '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)

const resolveTemplatePath = (ctxStack, path) => {
  if (!path || path === '.')
    return ctxStack[0]
  const parts = tokenizeTemplatePath(path)
  for (const ctx of ctxStack) {
    let current = ctx
    let found = true
    for (const part of parts) {
      if (current == null) {
        found = false
        break
      }
      current = current[part]
    }
    if (found && current !== undefined)
      return current
  }
  return undefined
}

const isPlainObject = value => Object.prototype.toString.call(value) === '[object Object]'

const renderTemplate = (template, ctxStack, options = {}) => {
  let output = String(template ?? '')
  const sectionRe = /\{\{([#^])([-\w.\[\]@]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g
  let match
  // eslint-disable-next-line no-cond-assign
  while ((match = sectionRe.exec(output))) {
    const [full, sigil, key, inner] = match
    const value = resolveTemplatePath(ctxStack, key)
    const inverted = sigil === '^'
    let replacement = ''
    if (!inverted) {
      if (Array.isArray(value))
        replacement = value.map(item => renderTemplate(inner, [item, ...ctxStack], options)).join('')
      else if (isPlainObject(value))
        replacement = renderTemplate(inner, [value, ...ctxStack], options)
      else if (value)
        replacement = renderTemplate(inner, ctxStack, options)
    }
    else if (!value || (Array.isArray(value) && value.length === 0)) {
      replacement = renderTemplate(inner, ctxStack, options)
    }
    output = output.slice(0, match.index) + replacement + output.slice(match.index + full.length)
    sectionRe.lastIndex = 0
  }

  output = output.replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (_, expr) => {
    const value = resolveTemplatePath(ctxStack, expr.trim())
    return value == null ? '' : String(value)
  })
  output = output.replace(/\{\{\s*([^#\/\^\s][^}]*)\}\}/g, (_, expr) => {
    const value = resolveTemplatePath(ctxStack, expr.trim())
    const normalized = value == null ? '' : String(value)
    return options.escape === false ? normalized : escapeHtml(normalized)
  })
  return output
}

const previewContent = computed(() => {
  const context = buildTemplateContext(previewSampleData.value, state.workingTemplate)
  return {
    subject: renderTemplate(state.workingTemplate.subject, [context], { escape: false }),
    html: renderTemplate(state.workingTemplate.html, [context]),
    text: renderTemplate(state.workingTemplate.text, [context], { escape: false }),
  }
})

const selectTemplate = (template) => {
  state.selectedTemplateId = template.docId
  applyWorkingTemplate(template)
}

const ensureDefaultTemplate = async () => {
  if (!collectionPath.value)
    return
  const existing = collectionData.value?.[DEFAULT_TEMPLATE_ID]
  if (!existing)
    await edgeFirebase.storeDoc(collectionPath.value, defaultTemplate, DEFAULT_TEMPLATE_ID)

  for (const template of props.systemTemplates || []) {
    const docId = String(template?.docId || '').trim()
    if (!docId || collectionData.value?.[docId])
      continue
    await edgeFirebase.storeDoc(collectionPath.value, {
      ...edgeGlobal.dupObject(template),
      docId,
      systemDefault: template.systemDefault !== false,
      doc_created_at: Date.now(),
      doc_updated_at: Date.now(),
    }, docId)
  }
}

const createTemplate = async () => {
  const docId = `template-${edgeGlobal.generateShortId()}`
  const nextTemplate = {
    ...edgeGlobal.dupObject(defaultTemplate),
    docId,
    name: 'New Template',
    systemDefault: false,
  }
  await edgeFirebase.storeDoc(collectionPath.value, nextTemplate, docId)
  state.selectedTemplateId = docId
  applyWorkingTemplate(nextTemplate)
}

const saveTemplate = async () => {
  if (!collectionPath.value || !state.workingTemplate?.docId)
    return
  state.loading = true
  const payload = {
    ...edgeGlobal.dupObject(state.workingTemplate),
    systemDefault: isProtectedTemplate.value,
    sampleData: previewSampleData.value,
    doc_updated_at: Date.now(),
  }
  if (!payload.doc_created_at)
    payload.doc_created_at = Date.now()
  await edgeFirebase.storeDoc(collectionPath.value, payload, payload.docId)
  state.loading = false
  edgeFirebase?.toast?.success?.('Email template saved.')
}

const confirmDeleteTemplate = () => {
  if (isProtectedTemplate.value)
    return
  state.deleteDialog = true
}

const deleteTemplate = async () => {
  if (!collectionPath.value || isProtectedTemplate.value)
    return
  const docId = state.workingTemplate.docId
  await edgeFirebase.removeDoc(collectionPath.value, docId)
  state.deleteDialog = false
  state.selectedTemplateId = DEFAULT_TEMPLATE_ID
  applyWorkingTemplate(collectionData.value?.[DEFAULT_TEMPLATE_ID] || defaultTemplate)
}

watch(selectedTemplate, (template) => {
  if (template)
    applyWorkingTemplate(template)
})

watch(collectionPath, async (nextPath, previousPath) => {
  if (previousPath)
    await edgeFirebase.stopSnapshot(previousPath)
  if (nextPath) {
    await edgeFirebase.startSnapshot(nextPath)
    await ensureDefaultTemplate()
  }
})

onMounted(async () => {
  if (collectionPath.value) {
    await edgeFirebase.startSnapshot(collectionPath.value)
    await ensureDefaultTemplate()
  }
  await nextTick()
  state.loaded = true
})

onBeforeUnmount(() => {
  if (collectionPath.value)
    edgeFirebase.stopSnapshot(collectionPath.value)
})
</script>

<template>
  <div v-if="state.loaded" class="flex min-h-[640px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <aside class="flex w-[240px] shrink-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
      <div class="border-b border-slate-200 p-3 dark:border-slate-800">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-100">
            <FileText class="h-4 w-4" />
            Templates
          </div>
          <edge-shad-button size="sm" class="h-8 bg-slate-900 text-xs text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300" @click="createTemplate">
            <Plus class="mr-1 h-3.5 w-3.5" />
            New
          </edge-shad-button>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        <button
          v-for="template in templates"
          :key="template.docId"
          type="button"
          class="mb-1 flex w-full items-start gap-3 rounded-md border px-3 py-3 text-left text-sm transition"
          :class="template.docId === state.selectedTemplateId
            ? 'border-slate-300 bg-white text-slate-950 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
            : 'border-transparent text-slate-600 hover:bg-white hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100'"
          @click="selectTemplate(template)"
        >
          <FileText class="mt-0.5 h-4 w-4 shrink-0" />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ template.name || template.docId }}</span>
            <span class="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">{{ template.docId }}</span>
          </span>
          <Badge v-if="template.docId === DEFAULT_TEMPLATE_ID" variant="outline" class="shrink-0 rounded-md px-1.5 py-0 text-[10px]">
            Default
          </Badge>
        </button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 bg-slate-100 dark:bg-slate-950">
      <div class="flex h-full min-h-[640px] flex-col">
        <div class="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Email Template
              </div>
              <div class="truncate text-lg font-semibold text-slate-950 dark:text-slate-100">
                {{ state.workingTemplate.name || 'Template' }}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <edge-shad-button
                v-if="!state.previewMode"
                variant="outline"
                class="h-9 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                @click="openPreview"
              >
                <Eye class="mr-2 h-4 w-4" />
                Preview
              </edge-shad-button>
              <edge-shad-button
                v-else
                variant="outline"
                class="h-9 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                @click="closePreview"
              >
                <Pencil class="mr-2 h-4 w-4" />
                Edit
              </edge-shad-button>
              <edge-shad-button variant="outline" class="h-9 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900" @click="state.helpOpen = !state.helpOpen">
                <BookOpen class="mr-2 h-4 w-4" />
                Help
              </edge-shad-button>
              <edge-shad-button
                variant="outline"
                class="h-9 border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                :disabled="isProtectedTemplate"
                @click="confirmDeleteTemplate"
              >
                <Trash2 class="mr-2 h-4 w-4" />
                Delete
              </edge-shad-button>
              <edge-shad-button class="h-9 bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300" :disabled="state.loading" @click="saveTemplate">
                <Save class="mr-2 h-4 w-4" />
                Save
              </edge-shad-button>
            </div>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div class="grid gap-4" :class="state.helpOpen ? 'xl:grid-cols-[minmax(0,1fr)_300px]' : 'xl:grid-cols-1'">
            <div class="space-y-4">
              <Card class="overflow-hidden border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <CardHeader class="border-b border-slate-200 p-2 dark:border-slate-800">
                  <Tabs v-if="!state.previewMode" class="w-full" :model-value="state.editorTab" @update:model-value="state.editorTab = $event">
                    <TabsList class="grid h-9 w-full grid-cols-3 border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
                      <TabsTrigger value="settings" class="h-7 text-xs text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:data-[state=active]:bg-slate-100 dark:data-[state=active]:text-slate-900">
                        Settings
                      </TabsTrigger>
                      <TabsTrigger value="html" class="h-7 text-xs text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:data-[state=active]:bg-slate-100 dark:data-[state=active]:text-slate-900">
                        HTML Template
                      </TabsTrigger>
                      <TabsTrigger value="text" class="h-7 text-xs text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:data-[state=active]:bg-slate-100 dark:data-[state=active]:text-slate-900">
                        Plain Template
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Tabs v-else class="w-full" :model-value="state.previewTab" @update:model-value="state.previewTab = $event">
                    <TabsList class="grid h-9 w-full grid-cols-3 border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
                      <TabsTrigger value="html" class="h-7 text-xs text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:data-[state=active]:bg-slate-100 dark:data-[state=active]:text-slate-900">
                        HTML Preview
                      </TabsTrigger>
                      <TabsTrigger value="text" class="h-7 text-xs text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:data-[state=active]:bg-slate-100 dark:data-[state=active]:text-slate-900">
                        Plain Preview
                      </TabsTrigger>
                      <TabsTrigger value="sampleData" class="h-7 text-xs text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:data-[state=active]:bg-slate-100 dark:data-[state=active]:text-slate-900">
                        Sample Data
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </CardHeader>
                <CardContent class="p-0">
                  <template v-if="state.previewMode">
                    <iframe v-if="state.previewTab === 'html'" class="h-[460px] w-full bg-white" :srcdoc="previewContent.html" />
                    <div v-else-if="state.previewTab === 'text'" class="h-[460px] overflow-y-auto bg-slate-50 p-4 dark:bg-slate-950">
                      <div class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {{ previewContent.subject }}
                      </div>
                      <pre class="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{{ previewContent.text }}</pre>
                    </div>
                    <vue-monaco-editor
                      v-else-if="state.previewTab === 'sampleData'"
                      v-model:value="state.sampleDataText"
                      :theme="edgeGlobal.isDarkMode() ? 'vs-dark' : 'vs'"
                      language="json"
                      :options="{
                        automaticLayout: true,
                        formatOnType: false,
                        formatOnPaste: false,
                      }"
                      style="height: 460px"
                    />
                  </template>
                  <div v-else-if="state.editorTab === 'settings'" class="grid gap-4 p-4 md:grid-cols-2">
                    <edge-shad-input v-model="state.workingTemplate.name" name="email-template-name" label="Name" />
                    <edge-shad-input v-model="state.workingTemplate.subject" name="email-template-subject" label="Subject" />
                    <div class="w-full md:col-span-2">
                      <label class="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Template ID</label>
                      <div class="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
                        <code class="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-300">
                          {{ state.workingTemplate.docId }}
                        </code>
                        <edge-clipboard-button :text="state.workingTemplate.docId" class="shrink-0" />
                      </div>
                    </div>
                    <div class="w-full md:col-span-2">
                      <edge-shad-tags
                        v-model="state.workingTemplate.excludedFields"
                        name="email-template-excluded-fields"
                        label="Exclude From All Fields"
                        description="These field names are hidden from all_fields and all_fields_html only."
                        placeholder="Type a field name and press Enter..."
                        value-as="array"
                        class="w-full"
                      />
                    </div>
                  </div>
                  <vue-monaco-editor
                    v-else
                    :key="state.editorTab"
                    v-model:value="activeEditorValue"
                    :theme="edgeGlobal.isDarkMode() ? 'vs-dark' : 'vs'"
                    :language="activeEditorLanguage"
                    :options="{
                      automaticLayout: true,
                      formatOnType: false,
                      formatOnPaste: false,
                    }"
                    style="height: 460px"
                  />
                </CardContent>
              </Card>
            </div>

            <aside v-if="state.helpOpen" class="space-y-4">
              <div class="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-100">
                  <BookOpen class="h-4 w-4" />
                  Template Help
                </div>
                <div class="space-y-3">
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Fields
                    </div>
                    <code class="mt-1 block rounded bg-slate-100 p-2 text-xs dark:bg-slate-950">{{ helpExamples.field }}</code>
                  </div>
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Nested Data
                    </div>
                    <code class="mt-1 block rounded bg-slate-100 p-2 text-xs dark:bg-slate-950">{{ helpExamples.nested }}</code>
                  </div>
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Array Loop
                    </div>
                    <code class="mt-1 block whitespace-pre rounded bg-slate-100 p-2 text-xs dark:bg-slate-950">{{ helpExamples.array }}</code>
                  </div>
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Empty Array
                    </div>
                    <code class="mt-1 block whitespace-pre rounded bg-slate-100 p-2 text-xs dark:bg-slate-950">{{ helpExamples.emptyArray }}</code>
                  </div>
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      All Fields
                    </div>
                    <code class="mt-1 block rounded bg-slate-100 p-2 text-xs dark:bg-slate-950">{{ helpExamples.allFieldsHtml }}</code>
                    <code class="mt-2 block rounded bg-slate-100 p-2 text-xs dark:bg-slate-950">{{ helpExamples.allFieldsText }}</code>
                  </div>
                </div>
              </div>

              <div class="rounded-lg border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                Field names in all-fields output are automatically normalized into readable labels.
              </div>
            </aside>
          </div>
        </div>
      </div>
    </main>

    <edge-shad-dialog v-model="state.deleteDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Email Template</DialogTitle>
          <DialogDescription>
            This will permanently delete "{{ state.workingTemplate.name || state.workingTemplate.docId }}".
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="flex justify-between pt-6">
          <edge-shad-button variant="outline" class="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900" @click="state.deleteDialog = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button variant="destructive" @click="deleteTemplate">
            Delete
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>
