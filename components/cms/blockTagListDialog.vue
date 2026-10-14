<script setup>
import { ArrowDown, ArrowUp, Loader2, Pencil, Trash2 } from 'lucide-vue-next'
import {
  QUICK_PICKS_TAG,
  addBlockTag,
  blockTagNameProblem,
  blockTagUsage,
  moveBlockTag,
  removeBlockTag,
  renameBlockTag,
} from '../../lib/cmsBlockTags'
import { useCmsBlockTagList } from '../../composables/useCmsBlockTagList'
import { useToast } from '@/components/ui/toast/use-toast'

// The organization's block tag list (`cmsBlockTags` on the organization
// document). Editing it never changes the tags blocks carry; renaming or
// removing a tag in use says how many blocks still carry the old one.
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
const { toast } = useToast()
const savedList = useCmsBlockTagList()

const state = reactive({
  list: [],
  newTag: '',
  newTagProblem: '',
  editing: '',
  editValue: '',
  editProblem: '',
  saving: false,
  error: '',
})

const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const reset = () => {
  state.list = [...savedList.value]
  state.newTag = ''
  state.newTagProblem = ''
  state.editing = ''
  state.editValue = ''
  state.editProblem = ''
  state.error = ''
}

watch(() => props.modelValue, (value) => {
  if (value)
    reset()
}, { immediate: true })

watch(() => state.newTag, () => {
  state.newTagProblem = ''
})

const usage = tag => blockTagUsage(props.blocks, tag)
const blocksLabel = count => `${count} ${count === 1 ? 'block carries' : 'blocks carry'}`
const hasChanges = computed(() => JSON.stringify(state.list) !== JSON.stringify(savedList.value))
const missingQuickPicks = computed(() => state.list.length > 0 && !state.list.includes(QUICK_PICKS_TAG))

// Tags removed or renamed in this edit that blocks still carry.
const orphanedTags = computed(() => savedList.value
  .filter(tag => !state.list.includes(tag))
  .map(tag => ({ tag, count: usage(tag) }))
  .filter(entry => entry.count > 0))

const addTag = () => {
  state.newTagProblem = blockTagNameProblem(state.newTag, state.list)
  if (state.newTagProblem)
    return
  state.list = addBlockTag(state.list, state.newTag)
  state.newTag = ''
}

const startRename = (tag) => {
  state.editing = tag
  state.editValue = tag
  state.editProblem = ''
}

const cancelRename = () => {
  state.editing = ''
  state.editProblem = ''
}

const finishRename = () => {
  const from = state.editing
  state.editProblem = blockTagNameProblem(state.editValue, state.list, { except: from })
  if (state.editProblem)
    return
  state.list = renameBlockTag(state.list, from, state.editValue)
  cancelRename()
}

const removeTag = (tag) => {
  state.list = removeBlockTag(state.list, tag)
}

const moveTag = (tag, offset) => {
  state.list = moveBlockTag(state.list, tag, offset)
}

const save = async () => {
  const orgId = String(edgeGlobal.edgeState.currentOrganization || '').trim()
  if (!orgId || state.saving)
    return
  state.saving = true
  state.error = ''
  try {
    const result = await edgeFirebase.changeDoc('organizations', orgId, { cmsBlockTags: state.list })
    if (!result?.success) {
      state.error = 'You do not have permission to change the block tag list.'
      return
    }
    toast({ title: '', description: state.list.length ? 'Block tag list saved.' : 'Block tag list cleared: tags are unrestricted.', duration: 2000 })
    open.value = false
  }
  catch (error) {
    state.error = String(error?.message || error || 'The block tag list could not be saved.')
  }
  finally {
    state.saving = false
  }
}
</script>

<template>
  <edge-shad-dialog v-model="open">
    <DialogContent class="pt-8 max-w-xl">
      <DialogHeader>
        <DialogTitle class="text-left">
          Block Tags
        </DialogTitle>
        <DialogDescription class="text-left">
          The tags blocks in this organization may carry, in the order the picker and library show them.
          Each block takes one or two, plus {{ QUICK_PICKS_TAG }} to appear in the picker's first view.
          Changing the list doesn't change any block's tags.
        </DialogDescription>
      </DialogHeader>

      <p
        v-if="!state.list.length"
        class="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
      >
        No list: blocks can carry any tag, and the Block Editor accepts new ones.
      </p>
      <ol v-else class="max-h-[50vh] space-y-1 overflow-y-auto pr-1" aria-label="Block tag list">
        <li
          v-for="(tag, index) in state.list"
          :key="tag"
          class="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700"
        >
          <template v-if="state.editing === tag">
            <div class="flex-1">
              <Input
                v-model="state.editValue"
                class="h-8"
                :aria-label="`New name for ${tag}`"
                @keydown.enter.prevent="finishRename"
                @keydown.esc.prevent="cancelRename"
              />
              <p v-if="state.editProblem" class="text-xs text-destructive" role="alert">
                {{ state.editProblem }}
              </p>
              <p v-else-if="usage(tag)" class="text-xs text-slate-500 dark:text-slate-400">
                {{ blocksLabel(usage(tag)) }} "{{ tag }}"; their tags stay as they are.
              </p>
            </div>
            <edge-shad-button size="sm" class="h-8" @click="finishRename">
              Rename
            </edge-shad-button>
            <edge-shad-button size="sm" variant="outline" class="h-8" @click="cancelRename">
              Cancel
            </edge-shad-button>
          </template>
          <template v-else>
            <span class="flex-1 text-sm text-slate-900 dark:text-slate-100">{{ tag }}</span>
            <span class="text-xs text-slate-500 dark:text-slate-400">{{ usage(tag) }} in use</span>
            <edge-shad-button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              :disabled="index === 0"
              :aria-label="`Move ${tag} up`"
              @click="moveTag(tag, -1)"
            >
              <ArrowUp class="h-4 w-4" />
            </edge-shad-button>
            <edge-shad-button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              :disabled="index === state.list.length - 1"
              :aria-label="`Move ${tag} down`"
              @click="moveTag(tag, 1)"
            >
              <ArrowDown class="h-4 w-4" />
            </edge-shad-button>
            <edge-shad-button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              :aria-label="`Rename ${tag}`"
              @click="startRename(tag)"
            >
              <Pencil class="h-4 w-4" />
            </edge-shad-button>
            <edge-shad-button
              size="icon"
              variant="ghost"
              class="h-8 w-8 text-red-600"
              :aria-label="`Remove ${tag}`"
              @click="removeTag(tag)"
            >
              <Trash2 class="h-4 w-4" />
            </edge-shad-button>
          </template>
        </li>
      </ol>

      <div class="space-y-1">
        <label for="block-tag-new" class="text-sm font-medium">Add a tag</label>
        <div class="flex items-center gap-2">
          <Input
            id="block-tag-new"
            v-model="state.newTag"
            class="flex-1"
            placeholder="Cards & Grids"
            @keydown.enter.prevent="addTag"
          />
          <edge-shad-button variant="outline" @click="addTag">
            Add
          </edge-shad-button>
        </div>
      </div>
      <p v-if="state.newTagProblem" class="-mt-2 text-xs text-destructive" role="alert">
        {{ state.newTagProblem }}
      </p>

      <div aria-live="polite" class="space-y-1 text-sm">
        <p v-if="missingQuickPicks" class="text-amber-700 dark:text-amber-300">
          {{ QUICK_PICKS_TAG }} isn't in the list: blocks that carry it will be flagged, though the picker still opens on it.
        </p>
        <p v-for="entry in orphanedTags" :key="entry.tag" class="text-amber-700 dark:text-amber-300">
          {{ blocksLabel(entry.count) }} "{{ entry.tag }}", which won't be in the list. Retag them in the Block Editor.
        </p>
        <p v-if="state.error" class="text-destructive" role="alert">
          {{ state.error }}
        </p>
      </div>

      <DialogFooter class="pt-2 flex justify-between">
        <edge-shad-button variant="outline" @click="open = false">
          Cancel
        </edge-shad-button>
        <edge-shad-button :disabled="!hasChanges || state.saving || !!state.editing" @click="save">
          <Loader2 v-if="state.saving" class="mr-2 h-4 w-4 animate-spin" />
          {{ state.saving ? 'Saving...' : 'Save list' }}
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
</template>
