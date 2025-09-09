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
  editMode: {
    type: Boolean,
    default: true,
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
  meta: {},
  arrayItems: {},
  reload: false,
})

const resetArrayItems = (field) => {
  if (!state.arrayItems?.[field]) {
    state.arrayItems[field] = {}
  }
  for (const schemaItem of Object.keys(modelValue.value.meta[field].schema)) {
    if (modelValue.value.meta[field].schema[schemaItem] === 'text') {
      state.arrayItems[field][schemaItem] = ''
    }
    else if (modelValue.value.meta[field].schema[schemaItem] === 'number') {
      state.arrayItems[field][schemaItem] = 0
    }
    else if (modelValue.value.meta[field].schema[schemaItem] === 'richtext') {
      state.arrayItems[field][schemaItem] = ''
    }
    else if (modelValue.value.meta[field].schema[schemaItem] === 'textarea') {
      state.arrayItems[field][schemaItem] = ''
    }
    else if (modelValue.value.meta[field].schema[schemaItem] === 'image') {
      state.arrayItems[field][schemaItem] = ''
    }
  }
}

const openEditor = () => {
  if (!props.editMode)
    return
  for (const key of Object.keys(modelValue.value?.meta || {})) {
    if (modelValue.value.meta[key]?.type === 'array' && modelValue.value.meta[key]?.schema) {
      resetArrayItems(key)
    }
  }
  state.draft = JSON.parse(JSON.stringify(modelValue.value?.values || {}))
  state.meta = JSON.parse(JSON.stringify(modelValue.value?.meta || {}))
  state.open = true
}

const save = () => {
  const updated = {
    ...modelValue.value,
    values: JSON.parse(JSON.stringify(state.draft)),
    meta: JSON.parse(JSON.stringify(state.meta)),
  }
  modelValue.value = updated
  state.open = false
}
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

const genTitleFromField = (field) => {
  return field
    // Insert space before a capital only if it's followed by a lowercase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, str => str.toUpperCase())
}
const addToArray = async (field) => {
  state.reload = true
  state.draft[field].push(JSON.parse(JSON.stringify(state.arrayItems[field])))
  resetArrayItems(field)
  await nextTick()
  state.reload = false
}
</script>

<template>
  <div>
    <div
      :class="{ 'cursor-pointer': props.editMode }"
      class="relative group "
      @click="openEditor"
    >
      <!-- Content -->
      <edge-cms-block-render :content="modelValue?.blockTemplate" :values="modelValue?.values" :meta="modelValue?.meta" />

      <!-- Darken overlay on hover -->
      <div v-if="props.editMode" class="pointer-events-none absolute inset-0 bg-black/50 opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-10" />

      <!-- Hover controls -->
      <div v-if="props.editMode" class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-20">
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

    <Sheet v-model:open="state.open">
      <SheetContent class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
        <SheetHeader>
          <SheetTitle>Edit Block</SheetTitle>
          <SheetDescription />
        </SheetHeader>

        <edge-shad-form>
          <div class="p-6 space-y-4  h-[calc(100vh-120px)] overflow-y-auto">
            <template v-for="entry in orderedMeta" :key="entry.field">
              <div v-if="entry.meta.type === 'array'">
                <div v-if="!entry.meta?.api">
                  <div v-if="entry.meta?.schema">
                    <Card v-if="!state.reload" class="mb-4 bg-white shadow-sm border border-gray-200 p-4">
                      <CardTitle class="mb-2">
                        {{ genTitleFromField(entry.field) }}
                      </CardTitle>
                      <template v-for="schemaItem in Object.keys(entry.meta.schema)" :key="schemaItem">
                        <edge-cms-block-input
                          v-model="state.arrayItems[entry.field][schemaItem]"
                          :type="entry.meta.schema[schemaItem]"
                          :field="schemaItem"
                          :label="genTitleFromField(schemaItem)"
                        />
                      </template>
                      <CardFooter>
                        <edge-shad-button
                          class="bg-secondary hover:text-primary/50 text-xs h-[26px] text-primary"
                          @click="addToArray(entry.field)"
                        >
                          Add Entry
                        </edge-shad-button>
                      </CardFooter>
                    </Card>
                    {{ state.draft[entry.field] }}
                  </div>
                  <edge-cms-block-input
                    v-else
                    v-model="state.draft[entry.field]"
                    :type="entry.meta.type"
                    :field="entry.field"
                    :label="genTitleFromField(entry.field)"
                  />
                </div>
                <div v-else>
                  <edge-shad-input v-model="state.meta[entry.field].api" name="api" label="API URL" />
                  <edge-shad-input v-model="state.meta[entry.field].apiField" name="apiField" label="API Field" />
                  <edge-shad-input v-model="state.meta[entry.field].apiQuery" name="apiQuery" label="API Query String" />
                  <edge-shad-number v-model="state.meta[entry.field].apiLimit" name="apiLimit" label="API Limit" />
                </div>
              </div>
              <div v-else-if="entry.meta?.options">
                <edge-shad-select
                  v-model="state.draft[entry.field]"
                  :label="genTitleFromField(entry.field)"
                  :name="entry.field"
                  :items="entry.meta.options || []"
                  item-title="title"
                  item-value="value"
                />
              </div>
              <div v-else>
                <edge-cms-block-input
                  v-model="state.draft[entry.field]"
                  :type="entry.meta.type"
                  :field="entry.field"
                  :label="genTitleFromField(entry.field)"
                />
              </div>
            </template>
          </div>
          <SheetFooter class="pt-2 flex justify-between">
            <edge-shad-button variant="destructive" class="text-white" @click="state.open = false">
              Cancel
            </edge-shad-button>
            <edge-shad-button class=" bg-slate-800 hover:bg-slate-400 w-full" @click="save">
              Save changes
            </edge-shad-button>
          </SheetFooter>
        </edge-shad-form>
      </SheetContent>
    </Sheet>
  </div>
</template>
