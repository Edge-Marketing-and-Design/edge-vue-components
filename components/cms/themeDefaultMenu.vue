<script setup>
import { computed, reactive, watch, watchEffect } from 'vue'
import { useVModel } from '@vueuse/core'
import { FileCog, File as FileIcon, FileMinus2, FilePen, Folder, FolderMinus, FolderPen, FolderPlus, GripVertical, Link, Plus } from 'lucide-vue-next'

const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
  },
  templateOptions: {
    type: Array,
    default: () => [],
  },
  templatePages: {
    type: Object,
    default: () => ({}),
  },
})

const emit = defineEmits(['update:modelValue'])

const modelValue = useVModel(props, 'modelValue', emit)

const ROOT_MENUS = ['Site Root', 'Not In Menu']
const dragGroup = { name: 'theme-default-menus', pull: true, put: true }

const state = reactive({
  folderDialog: {
    open: false,
    menu: '',
    value: '',
  },
  linkDialog: {
    open: false,
    mode: 'add',
    menu: '',
    folder: '',
    index: -1,
    name: '',
    url: '',
  },
  renameDialog: {
    open: false,
    type: 'page',
    menu: '',
    folder: '',
    index: -1,
    value: '',
  },
})

const ensureMenuStructure = () => {
  if (!modelValue.value || typeof modelValue.value !== 'object' || Array.isArray(modelValue.value))
    modelValue.value = {}
  for (const key of ROOT_MENUS) {
    if (!Array.isArray(modelValue.value[key]))
      modelValue.value[key] = []
  }
}

watchEffect(ensureMenuStructure)

const slugify = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') || 'page'
}

const uniqueSlug = (value, siblings = [], current = '', options = {}) => {
  const { forceSuffix = false } = options
  const base = slugify(value) || 'page'
  const siblingSet = new Set(siblings.filter(Boolean))
  if (current)
    siblingSet.delete(current)
  if (!forceSuffix) {
    let candidate = base
    let suffix = 1
    while (siblingSet.has(candidate)) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }
    return candidate
  }
  let suffix = 1
  let candidate = `${base}-${suffix}`
  while (siblingSet.has(candidate)) {
    suffix += 1
    candidate = `${base}-${suffix}`
  }
  return candidate
}

const uniqueDisplayName = (value, siblings = [], current = '') => {
  const base = String(value || '').trim() || 'Link'
  const siblingSet = new Set(siblings.filter(Boolean))
  if (current)
    siblingSet.delete(current)
  if (!siblingSet.has(base))
    return base
  let suffix = 2
  let candidate = `${base} (${suffix})`
  while (siblingSet.has(candidate)) {
    suffix += 1
    candidate = `${base} (${suffix})`
  }
  return candidate
}

const isExternalLinkEntry = entry => entry?.item && typeof entry.item === 'object' && entry.item.type === 'external'
const isFolder = entry => entry && typeof entry.item === 'object' && !isExternalLinkEntry(entry)
const isPageEntry = entry => typeof entry?.item === 'string'

const getFolderName = (entry) => {
  if (!isFolder(entry))
    return ''
  return Object.keys(entry.item || {})[0] || ''
}

const getFolderList = (menuName, folderName) => {
  const targetMenu = modelValue.value[menuName] || []
  const folderEntry = targetMenu.find(entry => isFolder(entry) && getFolderName(entry) === folderName)
  if (!folderEntry)
    return null
  return folderEntry.item[folderName]
}

const getParentList = (menuName, folderName = null) => {
  if (!folderName)
    return modelValue.value[menuName]
  return getFolderList(menuName, folderName)
}

const resolveTemplateTitle = (pageId) => {
  return props.templatePages?.[pageId]?.name || 'Untitled Page'
}

const siblingSlugs = (list = [], excludeIndex = -1) => {
  return list
    .map((entry, idx) => (idx === excludeIndex || !entry?.name) ? null : entry.name)
    .filter(Boolean)
}

const siblingNames = (list = [], excludeIndex = -1) => {
  return list
    .map((entry, idx) => (idx === excludeIndex ? null : entry?.name))
    .filter(Boolean)
}

const addPageToList = (list, pageId, nameHint) => {
  if (!Array.isArray(list))
    return
  const siblings = siblingSlugs(list)
  const slug = uniqueSlug(nameHint, siblings, '', { forceSuffix: true })
  list.push({
    name: slug,
    item: pageId,
    disableRename: false,
    disableDelete: false,
  })
}

const addPageToMenu = (menuName, pageId, folderName = null) => {
  if (!pageId)
    return
  const targetList = getParentList(menuName, folderName)
  if (!targetList)
    return
  addPageToList(targetList, pageId, resolveTemplateTitle(pageId))
}

const addLinkToMenu = (menuName, label, url, folderName = null) => {
  const targetList = getParentList(menuName, folderName)
  if (!targetList)
    return
  const siblings = siblingNames(targetList)
  const name = uniqueDisplayName(label, siblings)
  targetList.push({
    name,
    item: {
      type: 'external',
      url,
    },
  })
}

const removePage = (menuName, index, folderName = null) => {
  const targetList = getParentList(menuName, folderName)
  if (!targetList)
    return
  targetList.splice(index, 1)
}

const folderNamesInMenu = (menuName) => {
  return (modelValue.value[menuName] || [])
    .filter(entry => isFolder(entry))
    .map(entry => getFolderName(entry))
    .filter(Boolean)
}

const uniqueFolderSlug = (value, menuName, current = '') => {
  const names = new Set(folderNamesInMenu(menuName))
  if (current)
    names.delete(current)
  const base = slugify(value) || 'folder'
  let candidate = base
  let suffix = 1
  while (names.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const openAddFolderDialog = (menuName) => {
  state.folderDialog.menu = menuName
  state.folderDialog.value = ''
  state.folderDialog.open = true
}

const submitFolderDialog = () => {
  if (!state.folderDialog.menu)
    return
  const value = state.folderDialog.value?.trim()
  if (!value)
    return
  const slug = uniqueFolderSlug(value, state.folderDialog.menu)
  modelValue.value[state.folderDialog.menu].push({
    item: { [slug]: [] },
  })
  state.folderDialog.open = false
}

const canDeleteFolder = (entry) => {
  if (!isFolder(entry))
    return false
  const folderName = getFolderName(entry)
  return !(entry.item?.[folderName]?.length)
}

const deleteFolder = (menuName, index) => {
  const target = modelValue.value[menuName]?.[index]
  if (!target || !canDeleteFolder(target))
    return
  modelValue.value[menuName].splice(index, 1)
}

const openRenameDialogForPage = (menuName, index, folderName = null) => {
  const parentList = getParentList(menuName, folderName)
  if (!parentList?.[index] || isExternalLinkEntry(parentList[index]))
    return
  state.renameDialog = {
    open: true,
    type: 'page',
    menu: menuName,
    folder: folderName,
    index,
    value: parentList[index].name || '',
  }
}

const openRenameDialogForFolder = (menuName, folderName, index) => {
  state.renameDialog = {
    open: true,
    type: 'folder',
    menu: menuName,
    folder: folderName,
    index,
    value: folderName,
  }
}

const resetLinkDialog = () => {
  state.linkDialog.mode = 'add'
  state.linkDialog.menu = ''
  state.linkDialog.folder = ''
  state.linkDialog.index = -1
  state.linkDialog.name = ''
  state.linkDialog.url = ''
}

watch(() => state.linkDialog.open, (open) => {
  if (!open)
    resetLinkDialog()
})

const openAddLinkDialog = (menuName, folderName = null) => {
  state.linkDialog.mode = 'add'
  state.linkDialog.menu = menuName
  state.linkDialog.folder = folderName || ''
  state.linkDialog.index = -1
  state.linkDialog.name = ''
  state.linkDialog.url = ''
  state.linkDialog.open = true
}

const openEditLinkDialog = (menuName, index, entry, folderName = null) => {
  state.linkDialog.mode = 'edit'
  state.linkDialog.menu = menuName
  state.linkDialog.folder = folderName || ''
  state.linkDialog.index = index
  state.linkDialog.name = entry?.name || ''
  state.linkDialog.url = entry?.item?.url || ''
  state.linkDialog.open = true
}

const submitLinkDialog = () => {
  const label = state.linkDialog.name?.trim() || ''
  const url = state.linkDialog.url?.trim() || ''
  if (!label || !url)
    return
  const targetList = getParentList(state.linkDialog.menu, state.linkDialog.folder || null)
  if (!targetList)
    return
  if (state.linkDialog.mode === 'edit') {
    const target = targetList[state.linkDialog.index]
    if (!target || !isExternalLinkEntry(target))
      return
    const siblings = siblingNames(targetList, state.linkDialog.index)
    target.name = uniqueDisplayName(label, siblings, target.name)
    target.item = { type: 'external', url }
  }
  else {
    addLinkToMenu(state.linkDialog.menu, label, url, state.linkDialog.folder || null)
  }
  state.linkDialog.open = false
}

const submitRenameDialog = () => {
  if (!state.renameDialog.open)
    return
  const value = state.renameDialog.value?.trim()
  if (state.renameDialog.type === 'page') {
    const parentList = getParentList(state.renameDialog.menu, state.renameDialog.folder)
    const target = parentList?.[state.renameDialog.index]
    if (!parentList || !target)
      return
    const siblings = siblingSlugs(parentList, state.renameDialog.index)
    target.name = uniqueSlug(value || target.name, siblings, target.name)
  }
  else if (state.renameDialog.type === 'folder') {
    const folderList = modelValue.value[state.renameDialog.menu] || []
    const target = folderList[state.renameDialog.index]
    if (!isFolder(target))
      return
    const currentName = getFolderName(target)
    const slug = uniqueFolderSlug(value || currentName, state.renameDialog.menu, currentName)
    if (slug !== currentName) {
      target.item[slug] = target.item[currentName]
      delete target.item[currentName]
    }
  }
  state.renameDialog.open = false
}

const displayMenuName = menuName => (menuName === 'Site Root' ? 'Site Menu' : menuName)

const hasEntries = computed(() => {
  return ROOT_MENUS.some(menu => (modelValue.value[menu] || []).length)
})
</script>

<template>
  <div class="space-y-6">
    <div
      v-for="menuName in ROOT_MENUS"
      :key="menuName"
      class="rounded-lg border border-border bg-card/30 p-4 space-y-3"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-semibold">
            {{ displayMenuName(menuName) }}
          </p>
          <p class="text-xs text-muted-foreground">
            {{ menuName === 'Site Root' ? 'Visible navigation for new sites.' : 'Pages that are created but hidden from navigation.' }}
          </p>
        </div>
        <div class="flex gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <edge-shad-button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                :disabled="!templateOptions.length"
                aria-label="Add page"
              >
                <Plus class="w-4 h-4" />
              </edge-shad-button>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-64">
              <template v-if="templateOptions.length">
                <DropdownMenuItem
                  v-for="option in templateOptions"
                  :key="option.value"
                  @click="addPageToMenu(menuName, option.value)"
                >
                  {{ option.label }}
                </DropdownMenuItem>
              </template>
              <div v-else class="px-3 py-2 text-xs text-muted-foreground">
                All template pages are already assigned.
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem @click="openAddLinkDialog(menuName)">
                <Link class="w-4 h-4" />
                <span>External Link</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <edge-shad-button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            aria-label="Add folder"
            @click="openAddFolderDialog(menuName)"
          >
            <FolderPlus class="w-4 h-4" />
          </edge-shad-button>
        </div>
      </div>

      <draggable
        :list="modelValue[menuName]"
        handle=".drag-handle"
        item-key="name"
        class="space-y-3"
        :group="dragGroup"
      >
        <template #item="{ element, index }">
          <div v-if="isFolder(element)" class="rounded-md border border-border/60 bg-background/60">
            <div class="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
              <div class="flex items-center gap-2">
                <GripVertical class="w-4 h-4 text-muted-foreground drag-handle" />
                <div>
                  <div class="text-sm font-semibold flex items-center gap-1">
                    <Folder class="w-4 h-4" />
                    {{ getFolderName(element) }}
                  </div>
                  <div class="text-[11px] text-muted-foreground">
                    Folder
                  </div>
                </div>
              </div>
              <div class="flex gap-1">
                <edge-shad-button
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7"
                  @click="openRenameDialogForFolder(menuName, getFolderName(element), index)"
                >
                  <FolderPen class="w-3.5 h-3.5" />
                </edge-shad-button>
                <edge-shad-button
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7"
                  :disabled="!canDeleteFolder(element)"
                  @click="deleteFolder(menuName, index)"
                >
                  <FolderMinus class="w-3.5 h-3.5" />
                </edge-shad-button>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <edge-shad-button
                      size="icon"
                      class="h-7 w-7"
                      variant="ghost"

                      :disabled="!templateOptions.length"
                    >
                      <Plus class="w-3.5 h-3.5" />
                    </edge-shad-button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent class="w-64">
                    <template v-if="templateOptions.length">
                      <DropdownMenuItem
                        v-for="option in templateOptions"
                        :key="`${getFolderName(element)}-${option.value}`"
                        @click="addPageToMenu(menuName, option.value, getFolderName(element))"
                      >
                        {{ option.label }}
                      </DropdownMenuItem>
                    </template>
                    <div v-else class="px-3 py-2 text-xs text-muted-foreground">
                      All template pages are already assigned.
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem @click="openAddLinkDialog(menuName, getFolderName(element))">
                      <Link class="w-4 h-4" />
                      <span>External Link</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div class="space-y-2 border-l border-dashed border-border/80 px-2 py-2 ml-3">
              <div class="flex justify-end" />
              <draggable
                :list="element.item[getFolderName(element)]"
                handle=".drag-handle"
                item-key="name"
                class="space-y-2"
                :group="dragGroup"
              >
                <template #item="{ element: child, index: childIndex }">
                  <div class="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-card px-2 py-1.5">
                    <div class="flex items-center gap-2 flex-1 min-w-0">
                      <GripVertical class="w-4 h-4 text-muted-foreground drag-handle" />
                      <div class="min-w-0">
                        <div class="text-xs font-semibold flex items-center gap-1 leading-tight">
                          <template v-if="isExternalLinkEntry(child)">
                            <Link class="w-3.5 h-3.5" />
                            {{ child.name }}
                          </template>
                          <template v-else>
                            <FileIcon class="w-3.5 h-3.5" />
                            {{ child.name }}
                          </template>
                        </div>
                        <div class="text-[10px] text-muted-foreground leading-tight">
                          <template v-if="isExternalLinkEntry(child)">
                            {{ child.item?.url || 'External link' }}
                          </template>
                          <template v-else>
                            {{ resolveTemplateTitle(child.item) }}
                          </template>
                        </div>
                      </div>
                    </div>
                    <div class="flex gap-1">
                      <edge-shad-button
                        v-if="isExternalLinkEntry(child)"
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7"
                        @click="openEditLinkDialog(menuName, childIndex, child, getFolderName(element))"
                      >
                        <Link class="w-3.5 h-3.5" />
                      </edge-shad-button>
                      <edge-shad-button
                        v-else
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7"
                        @click="openRenameDialogForPage(menuName, childIndex, getFolderName(element))"
                      >
                        <FilePen class="w-3.5 h-3.5" />
                      </edge-shad-button>
                      <DropdownMenu v-if="isPageEntry(child)">
                        <DropdownMenuTrigger as-child>
                          <edge-shad-button
                            variant="ghost"
                            size="icon"
                            class="h-7 w-7"
                          >
                            <FileCog class="w-3.5 h-3.5" />
                          </edge-shad-button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" class="w-48">
                          <DropdownMenuCheckboxItem v-model="child.disableRename">
                            Disable Rename
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem v-model="child.disableDelete">
                            Disable Delete
                          </DropdownMenuCheckboxItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <edge-shad-button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 text-destructive"
                        @click="removePage(menuName, childIndex, getFolderName(element))"
                      >
                        <FileMinus2 class="w-3.5 h-3.5" />
                      </edge-shad-button>
                    </div>
                  </div>
                </template>
                <template #footer>
                  <p
                    v-if="!(element.item[getFolderName(element)] || []).length"
                    class="text-xs text-muted-foreground italic pl-1"
                  >
                    No pages in this folder yet.
                  </p>
                </template>
              </draggable>
            </div>
          </div>
          <div v-else class="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-card px-2 py-1.5">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <GripVertical class="w-4 h-4 text-muted-foreground drag-handle" />
              <div class="min-w-0">
                <div class="text-xs font-semibold flex items-center gap-1 leading-tight">
                  <template v-if="isExternalLinkEntry(element)">
                    <Link class="w-3.5 h-3.5" />
                    {{ element.name }}
                  </template>
                  <template v-else>
                    <FileIcon class="w-3.5 h-3.5" />
                    {{ element.name }}
                  </template>
                </div>
                <div class="text-[10px] text-muted-foreground leading-tight">
                  <template v-if="isExternalLinkEntry(element)">
                    {{ element.item?.url || 'External link' }}
                  </template>
                  <template v-else>
                    {{ resolveTemplateTitle(element.item) }}
                  </template>
                </div>
              </div>
            </div>
            <div class="flex gap-1">
              <edge-shad-button
                v-if="isExternalLinkEntry(element)"
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                @click="openEditLinkDialog(menuName, index, element)"
              >
                <Link class="w-3.5 h-3.5" />
              </edge-shad-button>
              <edge-shad-button
                v-else
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                @click="openRenameDialogForPage(menuName, index)"
              >
                <FilePen class="w-3.5 h-3.5" />
              </edge-shad-button>
              <DropdownMenu v-if="isPageEntry(element)">
                <DropdownMenuTrigger as-child>
                  <edge-shad-button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                  >
                    <FileCog class="w-3.5 h-3.5" />
                  </edge-shad-button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-48">
                  <DropdownMenuCheckboxItem v-model="element.disableRename">
                    Disable Rename
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem v-model="element.disableDelete">
                    Disable Delete
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <edge-shad-button
                variant="ghost"
                size="icon"
                class="h-7 w-7 text-destructive"
                @click="removePage(menuName, index)"
              >
                <FileMinus2 class="w-3.5 h-3.5" />
              </edge-shad-button>
            </div>
          </div>
        </template>
        <template #footer>
          <div
            v-if="!(modelValue[menuName] || []).length"
            class="rounded-md border border-dashed border-border/80 px-3 py-2 text-xs text-muted-foreground italic"
          >
            No entries yet. Use the buttons above to add pages or folders.
          </div>
        </template>
      </draggable>
    </div>

    <div v-if="!hasEntries" class="text-xs text-muted-foreground">
      Start by selecting template pages to include. Each page can only be used once across all menus.
    </div>
  </div>

  <edge-shad-dialog v-model="state.folderDialog.open">
    <DialogContent class="pt-10">
      <DialogHeader>
        <DialogTitle>Create Folder</DialogTitle>
      </DialogHeader>
      <edge-shad-input
        v-model="state.folderDialog.value"
        name="folderName"
        label="Folder Name"
        placeholder="Enter folder name"
      />
      <DialogFooter class="pt-2">
        <edge-shad-button
          variant="destructive"
          @click="state.folderDialog.open = false"
        >
          Cancel
        </edge-shad-button>
        <edge-shad-button
          type="button"
          class="bg-slate-800 hover:bg-slate-500 text-white"
          :disabled="!state.folderDialog.value?.trim()?.length"
          @click="submitFolderDialog"
        >
          Create
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>

  <edge-shad-dialog v-model="state.linkDialog.open">
    <DialogContent class="pt-10">
      <DialogHeader>
        <DialogTitle>
          {{ state.linkDialog.mode === 'edit' ? 'Edit External Link' : 'Add External Link' }}
        </DialogTitle>
      </DialogHeader>
      <div class="space-y-4">
        <edge-shad-input
          v-model="state.linkDialog.name"
          name="linkName"
          label="Label"
          placeholder="Link label"
        />
        <edge-shad-input
          v-model="state.linkDialog.url"
          name="linkUrl"
          label="URL"
          placeholder="https://example.com or tel:123-456-7890"
        />
      </div>
      <DialogFooter class="pt-2">
        <edge-shad-button
          variant="destructive"
          @click="state.linkDialog.open = false"
        >
          Cancel
        </edge-shad-button>
        <edge-shad-button
          type="button"
          class="bg-slate-800 hover:bg-slate-500 text-white"
          :disabled="!state.linkDialog.name?.trim()?.length || !state.linkDialog.url?.trim()?.length"
          @click="submitLinkDialog"
        >
          {{ state.linkDialog.mode === 'edit' ? 'Update Link' : 'Add Link' }}
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>

  <edge-shad-dialog v-model="state.renameDialog.open">
    <DialogContent class="pt-10">
      <DialogHeader>
        <DialogTitle>
          {{ state.renameDialog.type === 'folder' ? 'Rename Folder' : 'Rename Page Slug' }}
        </DialogTitle>
      </DialogHeader>
      <edge-shad-input
        v-model="state.renameDialog.value"
        name="renameValue"
        label="New Name"
        placeholder="Enter new name"
      />
      <DialogFooter class="pt-2">
        <edge-shad-button
          variant="destructive"
          @click="state.renameDialog.open = false"
        >
          Cancel
        </edge-shad-button>
        <edge-shad-button
          type="button"
          class="bg-slate-800 hover:bg-slate-500 text-white"
          :disabled="!state.renameDialog.value?.trim()?.length"
          @click="submitRenameDialog"
        >
          Save
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
</template>
