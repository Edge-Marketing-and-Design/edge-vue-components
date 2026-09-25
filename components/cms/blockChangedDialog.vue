<script setup>
// Asks what to do when a block save is refused because the block, or its
// unreleased draft, changed after it was loaded (for example a hand edit in
// the Hub, or an agent's save). Resolves true to replace the newer version.
const props = defineProps({
  conflict: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['resolve'])

const open = computed({
  get: () => !!props.conflict,
  // Closing the dialog any other way keeps the Hub's version.
  set: (value) => {
    if (!value)
      emit('resolve', false)
  },
})

const SOURCE_LABELS = { 'editor': 'the Block Editor', 'import': 'an import', 'page-editor': 'the page editor', 'agent': 'an agent' }

const details = computed(() => props.conflict?.details || {})
const changedWhere = computed(() => {
  const { draftRevision, draftSource, draftUpdatedAt } = details.value
  if (draftRevision === null || draftRevision === undefined)
    return 'Its released version is different from the one you started from.'
  const from = SOURCE_LABELS[draftSource] ? ` from ${SOURCE_LABELS[draftSource]}` : ''
  const when = draftUpdatedAt ? `, last saved ${new Date(draftUpdatedAt).toLocaleString()}` : ''
  return `Its unreleased draft (revision ${draftRevision}${from}${when}) has changes you haven't seen.`
})
const replaced = computed(() => (details.value.wouldReplace || []).join(', '))
</script>

<template>
  <edge-shad-dialog v-model="open">
    <DialogContent class="pt-8">
      <DialogHeader>
        <DialogTitle class="text-left">
          This block changed since you loaded it
        </DialogTitle>
        <DialogDescription class="space-y-2 text-left">
          <p>
            <code>{{ props.conflict?.blockName || props.conflict?.blockId }}</code> was changed after you opened it, for example by a
            hand edit in the Hub or an agent. {{ changedWhere }}
          </p>
          <p v-if="details.unknownBase">
            The imported file doesn't record which version of the block it was made from.
          </p>
          <p v-if="replaced">
            Saving now replaces: <code>{{ replaced }}</code>. The version you replace is kept with the draft and can be recovered.
          </p>
          <p>
            Keep the Hub's version to leave it untouched; your changes here are not saved. Reload the block to see its newer version.
          </p>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="pt-2 flex justify-between">
        <edge-shad-button variant="outline" autofocus @click="emit('resolve', false)">
          Keep the Hub's version
        </edge-shad-button>
        <edge-shad-button variant="destructive" @click="emit('resolve', true)">
          Replace it
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
</template>
