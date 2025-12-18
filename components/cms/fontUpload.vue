<script setup>
import { useVModel } from '@vueuse/core'

const props = defineProps({
  themeId: {
    type: String,
    required: true,
  },
  headJson: {
    type: String,
    default: '',
  },
})

const emits = defineEmits(['update:headJson'])

const edgeFirebase = inject('edgeFirebase')

const headJson = useVModel(props, 'headJson', emits, {
  passive: false,
  prop: 'headJson',
})

const state = reactive({
  files: [],
  uploading: false,
  errors: [],
  fontFamily: '',
  fontDisplay: 'swap',
  fileMeta: {},
})

const acceptList = ['.woff', '.woff2', '.ttf', '.otf', 'font/woff', 'font/woff2', 'application/font-woff', 'application/font-woff2', 'application/x-font-ttf', 'application/x-font-otf']
const normalizedAccept = computed(() => acceptList.join(','))
const collectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/files`)

const slugify = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '')

const parseHead = () => {
  try {
    return { ok: true, head: JSON.parse(headJson.value || '{}') || {} }
  }
  catch (e) {
    state.errors = ['Head JSON is invalid JSON. Fix it before adding fonts to avoid losing content.']
    return { ok: false, head: null }
  }
}

const setHeadJson = (head) => {
  if (!head || typeof head !== 'object')
    return
  headJson.value = JSON.stringify(head, null, 2)
}

const fileKey = file => file?.name || file?.file?.name || crypto.randomUUID()

const formatFromName = (name = '', contentType = '') => {
  const lower = (name || '').toLowerCase()
  const ext = lower.split('.').pop() || ''
  if (ext === 'woff2')
    return 'woff2'
  if (ext === 'woff')
    return 'woff'
  if (ext === 'otf')
    return 'opentype'
  if (ext === 'ttf')
    return 'truetype'
  if ((contentType || '').includes('woff2'))
    return 'woff2'
  if ((contentType || '').includes('woff'))
    return 'woff'
  if ((contentType || '').includes('otf'))
    return 'opentype'
  if ((contentType || '').includes('ttf'))
    return 'truetype'
  return null
}

const guessWeight = (name = '') => {
  const lower = name.toLowerCase()
  if (lower.includes('thin'))
    return '100'
  if (lower.includes('extralight') || lower.includes('extra-light'))
    return '200'
  if (lower.includes('light'))
    return '300'
  if (lower.includes('regular') || lower.includes('book') || lower.includes('normal'))
    return '400'
  if (lower.includes('medium'))
    return '500'
  if (lower.includes('semibold') || lower.includes('semi-bold') || lower.includes('demibold'))
    return '600'
  if (lower.includes('bold'))
    return '700'
  if (lower.includes('extrabold') || lower.includes('extra-bold'))
    return '800'
  if (lower.includes('black') || lower.includes('heavy'))
    return '900'
  return '400'
}

const guessStyle = (name = '') => {
  return name.toLowerCase().includes('italic') ? 'italic' : 'normal'
}

const ensureMetaForFiles = () => {
  const map = state.fileMeta || {}
  for (const file of state.files) {
    const key = fileKey(file)
    if (!map[key]) {
      map[key] = {
        weight: guessWeight(file?.name || file?.file?.name),
        style: guessStyle(file?.name || file?.file?.name),
      }
    }
  }
  // prune removed files
  const validKeys = new Set(state.files.map(f => fileKey(f)))
  for (const key of Object.keys(map)) {
    if (!validKeys.has(key))
      delete map[key]
  }
  state.fileMeta = { ...map }
}

watch(() => state.files, () => ensureMetaForFiles(), { deep: true })

const waitForR2 = async (docId) => {
  if (!docId || !collectionPath.value)
    return null

  const docKey = `${collectionPath.value}/${docId}`
  await edgeFirebase.startDocumentSnapshot(collectionPath.value, docId)

  return await new Promise((resolve) => {
    const stop = () => edgeFirebase.stopSnapshot(docKey)
    const unwatch = watch(() => edgeFirebase.data?.[docKey], (fileDoc) => {
      if (fileDoc?.uploadCompletedToR2 && fileDoc?.r2URL) {
        stop()
        unwatch()
        resolve(fileDoc)
      }
    }, { immediate: true, deep: true })
  })
}

const applyFontFaceToHead = (uploadedDocs, groupId) => {
  if (!uploadedDocs?.length)
    return

  const family = state.fontFamily.trim() || slugify(uploadedDocs[0]?.fileName || uploadedDocs[0]?.name || 'Custom Font')

  const encodeUrl = (url = '') => {
    try {
      return new URL(url).toString()
    }
    catch {
      return encodeURI(url)
    }
  }

  const styles = []
  for (const doc of uploadedDocs) {
    const key = doc?.fileName || doc?.name || doc?.docId
    const meta = state.fileMeta[key] || { weight: '400', style: 'normal' }
    const format = formatFromName(doc.fileName || doc.name, doc.contentType)
    if (!doc.r2URL || !format)
      continue
    const encodedUrl = encodeUrl(doc.r2URL)
    const css = `@font-face {\n  font-family: "${family}";\n  src: url("${encodedUrl}") format("${format}");\n  font-weight: ${meta.weight || '400'};\n  font-style: ${meta.style || 'normal'};\n  font-display: ${state.fontDisplay || 'swap'};\n}`
    styles.push({ css, id: `font-${slugify(family)}-${groupId}-${meta.weight}-${meta.style}` })
  }
  if (!styles.length)
    return

  const { ok, head } = parseHead()
  if (!ok || !head)
    return

  const headStyles = Array.isArray(head.style) ? [...head.style] : []
  const filtered = headStyles.filter(s => !s?.id || !s.id.startsWith(`font-${slugify(family)}-${groupId}`))
  styles.forEach((s) => {
    filtered.push({ id: s.id, children: s.css, innerHTML: s.css })
  })
  head.style = filtered
  setHeadJson(head)
}

const processFonts = async () => {
  state.errors = []
  if (!state.files.length) {
    state.errors = ['Add at least one font file before processing.']
    return
  }

  state.uploading = true
  const groupId = slugify(state.fontFamily || `font-${Date.now()}`)
  const uploadResults = []

  for (const file of state.files) {
    try {
      const key = fileKey(file)
      const result = await edgeFirebase.uploadFile(
        edgeGlobal.edgeState.currentOrganization,
        file.file,
        'fonts',
        false,
        true,
        {
          themeId: props.themeId,
          cmsFont: true,
          fontGroupId: groupId,
          autoLink: false,
        },
      )
      if (result?.meta?.fileDocId) {
        uploadResults.push({ docId: result.meta.fileDocId, meta: state.fileMeta[key] })
      }
      else
        state.errors.push(`Upload failed for "${file.name || file.file?.name}"`)
    }
    catch (e) {
      state.errors.push(`Upload failed for "${file.name || file.file?.name}": ${e?.message || e}`)
    }
  }

  const docs = []
  for (const { docId, meta } of uploadResults) {
    const doc = await waitForR2(docId)
    if (doc) {
      const key = doc.fileName || doc.name || doc.docId
      state.fileMeta[key] = meta || state.fileMeta[key] || { weight: '400', style: 'normal' }
      docs.push(doc)
    }
  }

  applyFontFaceToHead(docs, groupId)

  state.files = []
  state.uploading = false
}
</script>

<template>
  <div class="w-full space-y-2">
    <div class="grid grid-cols-2 gap-2">
      <edge-shad-input
        v-model="state.fontFamily"
        label="Font family"
        name="fontFamily"
        placeholder="e.g. Acme Sans"
        class="col-span-2"
      />
    </div>
    <file-upload
      v-model="state.files"
      :accept="normalizedAccept"
      name="fonts"
      :multiple="true"
      drop
      class="w-full"
    >
      <div class="w-full border border-dashed border-border bg-muted/40 text-foreground py-2 px-3 rounded-md cursor-pointer hover:border-primary/70 transition-colors min-h-[48px] flex items-center justify-between text-sm font-semibold">
        <span>Drag or click to select font files</span>
        <span class="text-xs font-normal text-muted-foreground">.woff / .woff2 / .ttf / .otf</span>
      </div>
    </file-upload>
    <div v-if="state.files.length" class="space-y-1 text-xs">
      <div class="flex justify-between text-muted-foreground">
        <span>Variant settings</span>
        <span>({{ state.files.length }} file{{ state.files.length === 1 ? '' : 's' }})</span>
      </div>
      <div class="space-y-1">
        <div
          v-for="file in state.files"
          :key="fileKey(file)"
          class="flex items-center gap-2 border border-border/60 rounded px-2 py-1"
        >
          <div class="flex-1 truncate text-foreground">
            {{ file.name || file.file?.name }}
          </div>
          <edge-shad-input
            v-model="state.fileMeta[fileKey(file)].weight"
            name="weight"
            placeholder="400"
            class="w-20"
            label="Weight"
          />
          <edge-shad-select
            v-model="state.fileMeta[fileKey(file)].style"
            name="style"
            :items="[{ title: 'Normal', name: 'normal' }, { title: 'Italic', name: 'italic' }]"
            class="w-28"
            label="Style"
          />
        </div>
      </div>
    </div>
    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <div>
        {{ state.files.length }} file{{ state.files.length === 1 ? '' : 's' }} queued
      </div>
      <edge-shad-button
        size="sm"
        :disabled="state.uploading || state.files.length === 0"
        @click="processFonts"
      >
        {{ state.uploading ? 'Processing…' : 'Process fonts' }}
      </edge-shad-button>
    </div>
    <template v-if="state.errors.length">
      <Alert
        v-for="(error, idx) in state.errors"
        :key="idx"
        variant="destructive"
        class="text-xs py-1"
      >
        <AlertTitle class="text-xs">
          Upload error
        </AlertTitle>
        <AlertDescription class="text-xs">
          {{ error }}
        </AlertDescription>
      </Alert>
    </template>
  </div>
</template>
