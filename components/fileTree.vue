<script setup>
const props = defineProps ({
  title: {
    type: String,
    required: false,
    default: '',
  },
  items: {
    type: Array,
    required: true,
    default: () => [],
  },
})

const emit = defineEmits(['fileDelete'])

const state = reactive({
  fileTypes: {
    'text/html': 'FileCode2',
    'application/javascript': 'FileCode2',
    'application/json': 'FileCode2',
    'application/xml': 'FileCode2',
    'text/markdown': 'FileCode2',
    'application/pdf': 'FileText',
    'image/png': 'FileImage',
    'text/plain': 'FileText',
    'image/svg+xml': 'FileImage',
    'image/jpeg': 'FileImage',
    'image/gif': 'FileImage',
    'image/webp': 'FileImage',
    'image/x-icon': 'FileImage',
    'application/vnd.ms-excel': 'FileSpreadsheet',
    'text/css': 'FileCode2',
    'image/vnd.microsoft.icon': 'FileImage', // ICO files
  },
})

const fileDelete = (value) => {
  emit('fileDelete', value)
}
</script>

<template>
  <Command class="rounded-lg border shadow-md w-full h-full border-0">
    <CommandList>
      <CommandGroup :heading="props.title">
        <template v-for="(item, index) in items" :key="index">
          <CommandItem v-if="edgeGlobal.objHas(item, 'children')" class="items-start" :value="item.title">
            <div class="w-full">
              <div class="flex items-center">
                <FolderOpen class="mr-2" />
                <span>{{ item.title }}</span>
              </div>
              <div class="ml-4 w-full">
                <edge-file-tree :items="item.children" @file-delete="fileDelete" />
              </div>
            </div>
          </CommandItem>
          <CommandItem v-else :value="item.title">
            <component :is="state.fileTypes[item.file]" class="mr-2" />
            <span>{{ item.title }}</span>
            <CommandShortcut>
              <edge-shad-button class="h-6 w-6 hover:bg-slate-600" variant="text" size="icon" @click.prevent.stop="fileDelete(item)">
                <Trash class="h-4 w-4" />
              </edge-shad-button>
            </CommandShortcut>
          </CommandItem>
        </template>
      </CommandGroup>
    </CommandList>
  </Command>
</template>
