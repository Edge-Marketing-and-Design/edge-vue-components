<script setup>
import { FileText, History, Loader2, Pencil, Play, RefreshCw, RotateCcw } from 'lucide-vue-next'
import {
  CMS_OPERATION_PROBLEMS,
  CMS_OPERATION_SPECS,
  CONTRACT_NOTE_MAX,
  checkOperation,
  clearContractNote,
  codeSegments,
  explanationFor,
  inputControl,
  listContractNotes,
  operationGroups,
  sampleOperation,
  setContractNote,
} from '../../lib/cmsAgentContractClient'

// The operations contract agents read (cms_contract), as developers review
// it: every operation as a form generated from CMS_OPERATION_SPECS, the rules
// the checks enforce, and the explanations, which developers can reword here.
// Rules change in code; only explanations change on this screen.
const edgeFirebase = inject('edgeFirebase')

const PROBLEMS_VIEW = 'problem-codes'
const groups = operationGroups()

const state = reactive({
  loading: false,
  error: '',
  defaults: {},
  notes: [],
  selected: groups[0]?.types[0] || PROBLEMS_VIEW,
  editing: null,
  saving: false,
  editError: '',
  checkText: '',
  checking: false,
  checkResult: null,
  checkError: '',
})

const orgId = computed(() => edgeGlobal.edgeState.currentOrganization)
const spec = computed(() => CMS_OPERATION_SPECS[state.selected] || null)
const explain = key => explanationFor(key, state.defaults, state.notes)
const editedKeys = computed(() => new Set(state.notes.filter(note => typeof note.text === 'string' && note.text.trim()).map(note => note.key)))
const operationEdited = type => [...editedKeys.value].some(key => key === `operation:${type}` || key.startsWith(`field:${type}.`))
const errorMessage = error => String(error?.message || error || 'Something went wrong.')
const formatDate = value => (value ? new Date(value).toLocaleString() : '')

const load = async () => {
  state.loading = true
  state.error = ''
  try {
    const result = await listContractNotes({ edgeFirebase })
    state.defaults = result.defaults || {}
    state.notes = result.notes || []
  }
  catch (error) {
    state.error = errorMessage(error)
  }
  finally {
    state.loading = false
  }
}

const select = (type) => {
  state.selected = type
  state.checkResult = null
  state.checkError = ''
  state.checkText = CMS_OPERATION_SPECS[type] ? JSON.stringify(sampleOperation(type), null, 2) : ''
}

const startEdit = (key, label) => {
  const current = explain(key)
  state.editError = ''
  state.editing = { key, label, text: current.text, current }
}

const saveEdit = async () => {
  const { key, text } = state.editing || {}
  if (!key || state.saving)
    return
  state.saving = true
  state.editError = ''
  try {
    await setContractNote({ edgeFirebase, key, text })
    await load()
    state.editing = null
  }
  catch (error) {
    state.editError = errorMessage(error)
  }
  finally {
    state.saving = false
  }
}

const resetEdit = async () => {
  const { key } = state.editing || {}
  if (!key || state.saving)
    return
  state.saving = true
  state.editError = ''
  try {
    await clearContractNote({ edgeFirebase, key })
    await load()
    state.editing = null
  }
  catch (error) {
    state.editError = errorMessage(error)
  }
  finally {
    state.saving = false
  }
}

const runCheck = async () => {
  state.checkError = ''
  state.checkResult = null
  let operation
  try {
    operation = JSON.parse(state.checkText)
  }
  catch (error) {
    state.checkError = `The operation is not valid JSON: ${error.message}`
    return
  }
  state.checking = true
  try {
    state.checkResult = await checkOperation({ edgeFirebase, orgId: orgId.value, operation })
  }
  catch (error) {
    state.checkError = errorMessage(error)
  }
  finally {
    state.checking = false
  }
}

const editOpen = computed({
  get: () => Boolean(state.editing),
  set: (open) => {
    if (!open && !state.saving)
      state.editing = null
  },
})

onMounted(async () => {
  select(state.selected)
  await load()
})
</script>

<template>
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="flex items-center gap-2 text-xl font-semibold">
          <FileText class="h-5 w-5" /> Agent contract
        </h2>
        <p class="mt-1 max-w-3xl text-sm text-muted-foreground">
          What agents read about each CMS operation (cms_contract). The forms and rules come from the code the Hub's checks
          run, so they are always current. You can reword the explanations; the rules change only in code.
        </p>
      </div>
      <edge-shad-button type="button" variant="outline" class="gap-2" :disabled="state.loading" @click="load">
        <Loader2 v-if="state.loading" class="h-4 w-4 animate-spin" />
        <RefreshCw v-else class="h-4 w-4" />
        Refresh
      </edge-shad-button>
    </div>

    <div v-if="state.error" role="alert" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
      {{ state.error }}
    </div>

    <div class="flex flex-col gap-4 lg:flex-row">
      <nav class="w-full shrink-0 rounded-lg border bg-card p-2 lg:w-64" aria-label="Operations">
        <div v-for="group in groups" :key="group.area" class="mb-2">
          <div class="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {{ group.title }}
          </div>
          <button
            v-for="type in group.types"
            :key="type"
            type="button"
            class="flex w-full items-center justify-between rounded px-2 py-1 text-left font-mono text-sm hover:bg-muted"
            :class="state.selected === type ? 'bg-muted font-semibold' : ''"
            @click="select(type)"
          >
            {{ type }}
            <span v-if="operationEdited(type)" class="ml-2 rounded bg-amber-100 px-1.5 text-[10px] font-sans text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">edited</span>
          </button>
        </div>
        <button
          type="button"
          class="mt-1 w-full rounded border-t px-2 py-2 text-left text-sm hover:bg-muted"
          :class="state.selected === PROBLEMS_VIEW ? 'bg-muted font-semibold' : ''"
          @click="select(PROBLEMS_VIEW)"
        >
          Problem codes
        </button>
      </nav>

      <section v-if="spec" class="min-w-0 flex-1 space-y-4">
        <div class="rounded-lg border bg-card p-4">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-mono text-lg font-semibold">
              {{ state.selected }}
            </h3>
            <span class="rounded bg-muted px-2 py-0.5 text-xs">{{ spec.scope }} session</span>
            <span class="rounded bg-muted px-2 py-0.5 text-xs">writes {{ spec.writes }}</span>
          </div>
          <div class="mt-3 flex items-start gap-2">
            <p class="flex-1 text-sm">
              <template v-for="(part, index) in codeSegments(explain(`operation:${state.selected}`).text)" :key="index">
                <code v-if="part.code" class="rounded bg-muted px-1 text-xs">{{ part.text }}</code><template v-else>
                  {{ part.text }}
                </template>
              </template>
              <span v-if="explain(`operation:${state.selected}`).edited" class="ml-1 text-xs text-amber-700 dark:text-amber-300">(edited)</span>
            </p>
            <edge-shad-button type="button" size="icon" variant="ghost" class="h-8 w-8" title="Edit the summary" @click="startEdit(`operation:${state.selected}`, `${state.selected} summary`)">
              <Pencil class="h-4 w-4" />
            </edge-shad-button>
          </div>
          <p v-if="spec.effect" class="mt-2 text-sm text-muted-foreground">
            <span class="font-medium text-foreground">Writes:</span>
            <template v-for="(part, index) in codeSegments(spec.effect)" :key="index">
              <code v-if="part.code" class="rounded bg-muted px-1 text-xs">{{ part.text }}</code>
              <template v-else>
                {{ part.text }}
              </template>
            </template>
          </p>
          <p class="mt-1 text-sm text-muted-foreground">
            <span class="font-medium text-foreground">Result:</span> <code>{{ spec.result }}</code>
            <span v-if="spec.closed"> No other keys are accepted.</span>
          </p>
        </div>

        <div class="rounded-lg border bg-card p-4">
          <h4 class="mb-3 font-semibold">
            Inputs
          </h4>
          <div class="space-y-4">
            <div v-for="(field, name) in spec.input" :key="name" class="grid min-w-0 gap-2 border-b pb-4 last:border-b-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <code class="font-semibold">{{ name }}</code>
                  <span class="text-xs text-muted-foreground">{{ field.type }}</span>
                  <span v-if="field.required" class="rounded bg-red-100 px-1.5 text-[10px] text-red-800 dark:bg-red-900/40 dark:text-red-200">required</span>
                </div>
                <div class="mt-2">
                  <edge-shad-select v-if="inputControl(field) === 'select'" :name="`preview-${name}`" :items="field.values.map(value => ({ name: value, title: value }))" :model-value="field.default || ''" disabled />
                  <edge-shad-switch v-else-if="inputControl(field) === 'switch'" :name="`preview-${name}`" :model-value="field.default === true" disabled />
                  <edge-shad-input v-else-if="inputControl(field) === 'number'" :name="`preview-${name}`" type="number" :placeholder="field.default !== undefined ? String(field.default) : '0'" disabled />
                  <edge-shad-textarea v-else-if="inputControl(field) === 'json' || inputControl(field) === 'textarea'" :name="`preview-${name}`" :placeholder="field.type === 'list' ? '[ ]' : field.type === 'object' ? '{ }' : ''" disabled />
                  <edge-shad-input v-else :name="`preview-${name}`" :placeholder="field.type === 'docId' ? 'document id' : ''" disabled />
                </div>
              </div>
              <div class="min-w-0 space-y-1 text-sm">
                <p v-if="field.values" class="flex flex-wrap items-center gap-1 text-muted-foreground">
                  One of <code v-for="value in field.values" :key="value" class="rounded bg-muted px-1 text-xs">{{ value }}</code>
                </p>
                <p v-if="field.default !== undefined" class="text-muted-foreground">
                  Default <code>{{ String(field.default) }}</code>
                </p>
                <p v-if="field.max" class="text-muted-foreground">
                  At most {{ field.max }} characters.
                </p>
                <p v-if="field.fields" class="flex flex-wrap items-center gap-1 text-muted-foreground">
                  Keys: <code v-for="key in field.fields" :key="key" class="rounded bg-muted px-1 text-xs">{{ key }}</code>
                </p>
                <div class="flex items-start gap-2">
                  <p class="flex-1">
                    <template v-for="(part, index) in codeSegments(explain(`field:${state.selected}.${name}`).text || 'No note.')" :key="index">
                      <code v-if="part.code" class="rounded bg-muted px-1 text-xs">{{ part.text }}</code><template v-else>
                        {{ part.text }}
                      </template>
                    </template>
                    <span v-if="explain(`field:${state.selected}.${name}`).edited" class="ml-1 text-xs text-amber-700 dark:text-amber-300">(edited)</span>
                  </p>
                  <edge-shad-button type="button" size="icon" variant="ghost" class="h-8 w-8" :title="`Edit the note for ${name}`" @click="startEdit(`field:${state.selected}.${name}`, `${state.selected}.${name} note`)">
                    <Pencil class="h-4 w-4" />
                  </edge-shad-button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-lg border bg-card p-4">
          <h4 class="mb-3 font-semibold">
            Refusals
          </h4>
          <div v-for="code in spec.problems" :key="code" class="flex items-start gap-2 border-b py-2 text-sm last:border-b-0">
            <code class="w-56 shrink-0">{{ code }}</code>
            <p class="flex-1">
              <template v-for="(part, index) in codeSegments(explain(`problem:${code}`).text)" :key="index">
                <code v-if="part.code" class="rounded bg-muted px-1 text-xs">{{ part.text }}</code><template v-else>
                  {{ part.text }}
                </template>
              </template>
              <span v-if="explain(`problem:${code}`).edited" class="ml-1 text-xs text-amber-700 dark:text-amber-300">(edited)</span>
            </p>
            <edge-shad-button type="button" size="icon" variant="ghost" class="h-8 w-8" :title="`Edit the explanation of ${code}`" @click="startEdit(`problem:${code}`, `${code} explanation`)">
              <Pencil class="h-4 w-4" />
            </edge-shad-button>
          </div>
        </div>

        <div class="rounded-lg border bg-card p-4">
          <h4 class="font-semibold">
            Try a check
          </h4>
          <p class="mb-3 text-sm text-muted-foreground">
            Checks the operation as you, in this organization, and shows what it would change or why it is refused. It writes nothing.
          </p>
          <edge-shad-textarea v-model="state.checkText" name="checkOperation" class="font-mono text-xs" />
          <div class="mt-2 flex items-center gap-2">
            <edge-shad-button type="button" class="gap-2" :disabled="state.checking" @click="runCheck">
              <Loader2 v-if="state.checking" class="h-4 w-4 animate-spin" />
              <Play v-else class="h-4 w-4" />
              Check
            </edge-shad-button>
          </div>
          <div v-if="state.checkError" role="alert" class="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {{ state.checkError }}
          </div>
          <div v-if="state.checkResult" class="mt-3 space-y-2 text-sm">
            <p :class="state.checkResult.blocked ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'" class="font-medium">
              {{ state.checkResult.blocked ? 'Refused' : 'Would run' }}
            </p>
            <ul v-if="state.checkResult.problems?.length" class="space-y-1">
              <li v-for="(problem, index) in state.checkResult.problems" :key="index">
                <code class="mr-2">{{ state.checkResult.problemCodes?.[index] }}</code>{{ problem }}
              </li>
            </ul>
            <ul v-if="state.checkResult.summary?.length" class="list-disc pl-5 text-muted-foreground">
              <li v-for="(line, index) in state.checkResult.summary" :key="index">
                {{ line }}
              </li>
            </ul>
            <ul v-if="state.checkResult.notices?.length" class="list-disc pl-5 text-amber-800 dark:text-amber-200">
              <li v-for="(notice, index) in state.checkResult.notices" :key="index">
                {{ notice }}
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section v-else class="min-w-0 flex-1 rounded-lg border bg-card p-4">
        <h3 class="mb-3 text-lg font-semibold">
          Problem codes
        </h3>
        <div v-for="code in Object.keys(CMS_OPERATION_PROBLEMS)" :key="code" class="flex items-start gap-2 border-b py-2 text-sm last:border-b-0">
          <code class="w-56 shrink-0">{{ code }}</code>
          <p class="flex-1">
            <template v-for="(part, index) in codeSegments(explain(`problem:${code}`).text)" :key="index">
              <code v-if="part.code" class="rounded bg-muted px-1 text-xs">{{ part.text }}</code><template v-else>
                {{ part.text }}
              </template>
            </template>
            <span v-if="explain(`problem:${code}`).edited" class="ml-1 text-xs text-amber-700 dark:text-amber-300">(edited)</span>
          </p>
          <edge-shad-button type="button" size="icon" variant="ghost" class="h-8 w-8" :title="`Edit the explanation of ${code}`" @click="startEdit(`problem:${code}`, `${code} explanation`)">
            <Pencil class="h-4 w-4" />
          </edge-shad-button>
        </div>
      </section>
    </div>

    <edge-shad-dialog v-model="editOpen">
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <DialogTitle class="text-left">
            Edit {{ state.editing?.label }}
          </DialogTitle>
          <DialogDescription class="text-left">
            Agents read this text in the operations contract. It explains the rule; it can't change it.
          </DialogDescription>
        </DialogHeader>
        <div v-if="state.editing" class="space-y-3">
          <edge-shad-textarea v-model="state.editing.text" name="contractNote" />
          <p class="text-xs text-muted-foreground">
            {{ (state.editing.text || '').length }} / {{ CONTRACT_NOTE_MAX }} characters
          </p>
          <div class="rounded-md border bg-muted/40 p-3 text-sm">
            <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Default (from code)
            </div>
            {{ state.editing.current.defaultText || 'No default text.' }}
          </div>
          <div v-if="state.editing.current.edited" class="text-xs text-muted-foreground">
            Edited {{ formatDate(state.editing.current.updatedAt) }}
          </div>
          <details v-if="state.editing.current.history.length" class="text-sm">
            <summary class="flex cursor-pointer items-center gap-1 text-muted-foreground">
              <History class="h-4 w-4" /> Earlier versions ({{ state.editing.current.history.length }})
            </summary>
            <ul class="mt-2 space-y-2">
              <li v-for="(entry, index) in state.editing.current.history" :key="index" class="rounded border p-2">
                <div class="text-xs text-muted-foreground">
                  {{ formatDate(entry.updatedAt) }}
                </div>
                {{ entry.text }}
              </li>
            </ul>
          </details>
          <div v-if="state.editError" role="alert" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {{ state.editError }}
          </div>
        </div>
        <DialogFooter class="flex justify-between gap-2 pt-2">
          <edge-shad-button v-if="state.editing?.current.edited" type="button" variant="outline" class="gap-2" :disabled="state.saving" @click="resetEdit">
            <RotateCcw class="h-4 w-4" /> Reset to default
          </edge-shad-button>
          <div class="ml-auto flex gap-2">
            <edge-shad-button type="button" variant="outline" :disabled="state.saving" @click="editOpen = false">
              Cancel
            </edge-shad-button>
            <edge-shad-button type="button" class="gap-2" :disabled="state.saving || !(state.editing?.text || '').trim() || (state.editing?.text || '').length > CONTRACT_NOTE_MAX" @click="saveEdit">
              <Loader2 v-if="state.saving" class="h-4 w-4 animate-spin" />
              Save
            </edge-shad-button>
          </div>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>
