<script setup>
const props = defineProps({
  change: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['resolve'])

const open = computed({
  get: () => !!props.change,
  // Closing the dialog any other way (Escape, overlay) keeps the old name.
  set: (value) => {
    if (!value)
      emit('resolve', false)
  },
})
</script>

<template>
  <edge-shad-dialog v-model="open">
    <DialogContent class="pt-8">
      <DialogHeader>
        <DialogTitle class="text-left">
          Rename Override Block?
        </DialogTitle>
        <DialogDescription class="space-y-2 text-left">
          <p>
            <code>{{ props.change?.fromName }}</code> is an override block. The public site finds its custom component by name.
          </p>
          <p>
            Pages that already use it keep the old name and keep working. Blocks placed after the rename use
            <code>{{ props.change?.toName || '(no name)' }}</code> and may show only the block's CMS HTML until a matching override is deployed.
          </p>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="pt-2 flex justify-between">
        <edge-shad-button variant="outline" autofocus @click="emit('resolve', false)">
          Keep Old Name
        </edge-shad-button>
        <edge-shad-button variant="destructive" @click="emit('resolve', true)">
          Rename Anyway
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
</template>
