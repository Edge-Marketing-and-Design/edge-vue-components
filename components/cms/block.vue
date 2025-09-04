<script setup>
import { useVModel } from '@vueuse/core'

const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
  },
  blockId: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['update:modelValue', 'delete'])

function extractFieldsInOrder(template) {
  if (!template || typeof template !== 'string')
    return []
  const fields = []
  const seen = new Set()
  const TAG_RE = /\{\{\{#[^\s]+\s+(\{[\s\S]*?\})\}\}\}/g
  let m = TAG_RE.exec(template)
  while (m) {
    const cfg = m[1]
    const fm = cfg.match(/"field"\s*:\s*"([^"]+)"/)
    if (fm && !seen.has(fm[1])) {
      fields.push(fm[1])
      seen.add(fm[1])
    }
    m = TAG_RE.exec(template)
  }
  return fields
}

const modelValue = useVModel(props, 'modelValue', emit)

const state = reactive({
  open: false,
  draft: {},
  delete: false,
})

const openEditor = () => {
  state.draft = JSON.parse(JSON.stringify(modelValue.value?.values || {}))
  state.open = true
}

const save = () => {
  const updated = {
    ...modelValue.value,
    values: JSON.parse(JSON.stringify(state.draft)),
  }
  modelValue.value = updated
  state.open = false
}

const meta = computed(() => {
  return modelValue.value?.meta || {}
})

const orderedMeta = computed(() => {
  const metaObj = modelValue.value?.meta || {}
  const tpl = modelValue.value?.blockTemplate || ''
  const orderedFields = extractFieldsInOrder(tpl)

  const out = []
  const picked = new Set()

  for (const f of orderedFields) {
    if (f in metaObj) {
      out.push({ field: f, meta: metaObj[f] })
      picked.add(f)
    }
  }

  for (const f of Object.keys(metaObj)) {
    if (!picked.has(f)) {
      out.push({ field: f, meta: metaObj[f] })
    }
  }

  return out
})
</script>

<template>
  <div>
    <div
      class="relative group cursor-pointer"
      @click="openEditor"
    >
      <!-- Content -->
      <edge-cms-block-render :content="modelValue?.blockTemplate" :values="modelValue?.values" />

      <!-- Darken overlay on hover -->
      <div class="pointer-events-none absolute inset-0 bg-black/50 opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-10" />

      <!-- Hover controls -->
      <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-20">
        <!-- Delete button top right -->
        <div class="absolute top-2 right-2">
          <edge-shad-button
            variant="destructive"
            size="icon"
            @click.stop.prevent="state.delete = true"
          >
            <Trash class="h-4 w-4" />
          </edge-shad-button>
        </div>

        <!-- Edit button centered -->
        <div class="flex items-center justify-center h-full">
          <!-- <edge-shad-button class="text-xl py-6 px-8" @click.stop.prevent="openEditor">
            <Pencil class="w-4 h-4 mr-1" />
            Edit
          </edge-shad-button> -->
        </div>
      </div>
    </div>
    <edge-shad-dialog v-model="state.delete">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Block</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Are you sure you want to delete this block?
        </DialogDescription>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button class="text-white bg-slate-800 hover:bg-slate-400" @click="state.delete = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button variant="destructive" class="text-white w-full" @click="emit('delete', props.blockId); state.delete = false">
            Delete
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>

    <edge-shad-dialog v-model="state.open">
      <DialogContent class="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Block</DialogTitle>
        </DialogHeader>
        <DialogDescription />

        <div class="mt-4 space-y-4">
          <edge-shad-form>
            <template v-for="entry in orderedMeta" :key="entry.field">
              <div v-if="entry.meta.type === 'array'">
                <edge-shad-tags v-model="state.draft[entry.field]" :label="entry.meta.title" :name="entry.field" />
              </div>
              <div v-else-if="entry.meta?.options">
                <!-- Treat text and image as plain strings; image expected to be URL -->
                <edge-shad-select
                  v-model="state.draft[entry.field]"
                  :label="entry.meta.title"
                  :name="entry.field"
                  :items="entry.meta.options || []"
                  item-title="title"
                  item-value="value"
                />
              </div>
              <div v-else>
                <edge-shad-input v-model="state.draft[entry.field]" :name="entry.field" :label="entry.meta.title" />
              </div>
            </template>
          </edge-shad-form>
        </div>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="destructive" class="text-white" @click="state.open = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button class=" bg-slate-800 hover:bg-slate-400 w-full" @click="save">
            Save
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>
