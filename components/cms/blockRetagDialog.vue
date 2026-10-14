<script setup>
import { Loader2 } from 'lucide-vue-next'
import { parseBlockRetagInput, planBlockRetag } from '../../lib/cmsBlockTags'
import { useCmsBlockTagList } from '../../composables/useCmsBlockTagList'

// Applies a { blockId: tags } mapping to library blocks in one step. Tags are
// metadata: each write changes only `tags`, never the definition, so no draft,
// release or page write follows (cms-blocks contract, Propagation).
const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  blocks: {
    type: Object,
    default: () => ({}),
  },
})
const emit = defineEmits(['update:modelValue'])

const edgeFirebase = inject('edgeFirebase')
const blockTagList = useCmsBlockTagList()

const state = reactive({
  input: '',
  parseProblems: [],
  plan: null,
  applying: false,
  done: 0,
  results: null,
})

const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

watch(() => props.modelValue, (value) => {
  if (value) {
    state.parseProblems = []
    state.plan = null
    state.results = null
    state.done = 0
  }
})

// A new paste invalidates the preview.
watch(() => state.input, () => {
  state.plan = null
  state.results = null
})

const preview = () => {
  const { mapping, problems } = parseBlockRetagInput(state.input)
  state.parseProblems = problems
  state.results = null
  state.plan = problems.length ? null : planBlockRetag(props.blocks, mapping, blockTagList.value)
}

const canApply = computed(() => !!state.plan && !state.plan.invalid.length && state.plan.changes.length > 0 && !state.applying)

const apply = async () => {
  if (!canApply.value)
    return
  state.applying = true
  state.done = 0
  const results = { updated: [], skipped: [], failed: [] }
  const blocksPath = `${edgeGlobal.edgeState.organizationDocPath}/blocks`
  for (const change of state.plan.changes) {
    // Skip a block whose tags changed since the preview.
    const current = Array.isArray(props.blocks?.[change.blockId]?.tags) ? props.blocks[change.blockId].tags : []
    if (JSON.stringify(current) !== JSON.stringify(change.before)) {
      results.skipped.push(`${change.name}: its tags changed since the preview.`)
    }
    else {
      try {
        const result = await edgeFirebase.changeDoc(blocksPath, change.blockId, { tags: change.after })
        if (result?.success === false)
          results.failed.push(`${change.name}: ${result.message || 'not saved'}`)
        else
          results.updated.push(change.blockId)
      }
      catch (error) {
        results.failed.push(`${change.name}: ${String(error?.message || error)}`)
      }
    }
    state.done += 1
  }
  state.results = results
  state.plan = null
  state.applying = false
}

const tagText = tags => (tags.length ? tags.join(', ') : 'no tags')
</script>

<template>
  <edge-shad-dialog v-model="open">
    <DialogContent class="pt-8 max-w-3xl">
      <DialogHeader>
        <DialogTitle class="text-left">
          Retag Blocks
        </DialogTitle>
        <DialogDescription class="text-left">
          Paste a mapping: the mapping table (block ids in backticks, proposed tags in the fourth column) or JSON
          <code>{ "blockId": ["Tag"] }</code>. Preview it, then apply. Only each block's tags change: no drafts,
          no releases, no page changes. Every new tag set must follow the organization's block tag list.
        </DialogDescription>
      </DialogHeader>

      <Textarea
        v-model="state.input"
        aria-label="Retag mapping"
        class="h-40 font-mono text-xs"
        placeholder="| Block | ID | Current tags | Proposed tags | Note |"
        :disabled="state.applying"
      />

      <div aria-live="polite" class="max-h-[40vh] space-y-2 overflow-y-auto text-sm">
        <p v-for="problem in state.parseProblems" :key="problem" class="text-destructive" role="alert">
          {{ problem }}
        </p>

        <template v-if="state.plan">
          <p class="font-medium">
            {{ state.plan.changes.length }} to change · {{ state.plan.unchanged.length }} already tagged ·
            {{ state.plan.missing.length }} not in the library · {{ state.plan.invalid.length }} with problems
          </p>
          <div v-if="state.plan.invalid.length" class="space-y-1 text-destructive" role="alert">
            <p>Fix these rows before applying:</p>
            <p v-for="row in state.plan.invalid" :key="row.blockId">
              {{ row.name }} (<code>{{ row.blockId }}</code>): {{ row.problems.join(' ') }}
            </p>
          </div>
          <p v-if="state.plan.missing.length" class="text-amber-700 dark:text-amber-300">
            Not in this library (skipped): {{ state.plan.missing.join(', ') }}
          </p>
          <ul v-if="state.plan.changes.length" class="space-y-1" aria-label="Tag changes">
            <li v-for="change in state.plan.changes" :key="change.blockId" class="border-b border-slate-200 pb-1 dark:border-slate-700">
              <span class="font-medium">{{ change.name }}</span>
              <span class="text-slate-500 dark:text-slate-400"> · {{ tagText(change.before) }} → </span>
              <span>{{ tagText(change.after) }}</span>
            </li>
          </ul>
        </template>

        <p v-if="state.applying">
          Applying {{ state.done }} of {{ state.plan?.changes.length || 0 }}...
        </p>
        <template v-if="state.results">
          <p class="font-medium">
            Updated {{ state.results.updated.length }} block(s).
            <template v-if="state.results.skipped.length || state.results.failed.length">
              {{ state.results.skipped.length }} skipped, {{ state.results.failed.length }} failed. Preview again to retry them.
            </template>
          </p>
          <p v-for="line in [...state.results.skipped, ...state.results.failed]" :key="line" class="text-amber-700 dark:text-amber-300">
            {{ line }}
          </p>
        </template>
      </div>

      <DialogFooter class="pt-2 flex justify-between">
        <edge-shad-button variant="outline" :disabled="state.applying" @click="open = false">
          Close
        </edge-shad-button>
        <div class="flex gap-2">
          <edge-shad-button variant="outline" :disabled="state.applying" @click="preview">
            Preview
          </edge-shad-button>
          <edge-shad-button :disabled="!canApply" @click="apply">
            <Loader2 v-if="state.applying" class="mr-2 h-4 w-4 animate-spin" />
            Apply {{ state.plan?.changes.length || 0 }} change(s)
          </edge-shad-button>
        </div>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
</template>
