import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { computed, reactive } from 'vue'
import { useVModel } from '@vueuse/core'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const input = await readFile(new URL('../components/cms/blockInput.vue', import.meta.url), 'utf8')
const legacy = await readFile(new URL('../components/cms/block.vue', import.meta.url), 'utf8')

test('image clear emits an empty field value, closes picker and hides its control', () => {
  const props = reactive({ modelValue: 'https://example.com/photo.jpg' })
  const emitted = []
  const modelValue = useVModel(props, 'modelValue', (event, value) => {
    emitted.push({ event, value })
    props.modelValue = value
  })
  const state = { imageOpen: true }
  const source = input.slice(input.indexOf('const resolvedImageUrl ='), input.indexOf('const isVideoPicker ='))
  const { hasImageValue } = runInNewContext(`${source};({ hasImageValue })`, { modelValue, computed })
  assert.equal(hasImageValue.value, true)
  const start = input.indexOf('const clearImage =')
  const clear = runInNewContext(`${input.slice(start, input.indexOf('const selectVideo =', start))}; clearImage`, { modelValue, state })
  clear()
  assert.equal(props.modelValue, '')
  assert.equal(state.imageOpen, false)
  assert.equal(hasImageValue.value, false)
  assert.deepEqual(emitted, [{ event: 'update:modelValue', value: '' }])
})

test('legacy clear changes only the selected draft field and picker state', () => {
  const handler = legacy.match(/@click\.stop="(state\.draft\[entry\.field\] = ''; state\.imageOpenByField\[entry\.field\] = false)"/)[1]
  const state = { draft: { image: 'photo.jpg', other: 'keep.jpg', imageAlt: 'Keep this text' }, imageOpenByField: { image: true } }
  runInNewContext(handler, { state, entry: { field: 'image' } })
  assert.deepEqual(state.draft, { image: '', other: 'keep.jpg', imageAlt: 'Keep this text' })
  assert.equal(state.imageOpenByField.image, false)
})

test('clear actions sit at the far right of the image label row, outside picker triggers', () => {
  for (const [source, condition] of [[input, 'hasImageValue'], [legacy, 'state.draft[entry.field]']]) {
    const labelRow = source.match(/<div class="mb-2 flex w-full items-center justify-between gap-2">[\s\S]*?<\/div>/)[0]
    assert.ok(labelRow.includes(`v-if="${condition}"`))
    assert.match(labelRow, /type="button"/)
    assert.match(labelRow, /size="sm"/)
    assert.match(labelRow, /ml-auto h-6 shrink-0/)
    assert.match(labelRow, /:aria-label="`Clear /)
    assert.match(labelRow, /Clear image/)
    assert.doesNotMatch(labelRow, /DialogTrigger|opacity-0|deleteDoc|removeDoc/)
  }
})

test('empty image fields expose Select Image without hovering, including after clear', () => {
  const emptyInput = input.match(/<edge-shad-button\s+v-if="!hasImageValue"[\s\S]*?<\/edge-shad-button>/)[0]
  assert.match(emptyInput, /Select Image/)
  assert.doesNotMatch(emptyInput, /opacity-0/)
  const imageSection = legacy.slice(legacy.indexOf('<div v-else-if="entry.meta?.type === \'image\'"'), legacy.indexOf('<div v-else-if="entry.meta?.type === \'publication\'"'))
  const expression = imageSection.match(/:class="(state\.draft\[entry\.field\] \? [^"]+)"/)[1]
  const state = { draft: { photo: 'photo.jpg' } }
  const classes = () => runInNewContext(expression, { state, entry: { field: 'photo' } })
  assert.match(classes(), /opacity-0 hover:opacity-100/)
  state.draft.photo = ''
  assert.match(classes(), /relative min-h-20/)
  assert.doesNotMatch(classes(), /opacity-0|absolute/)
  assert.match(imageSection, /Select Image/)
})

test('both CMS image field components compile', () => {
  for (const [source, filename] of [[input, 'blockInput.vue'], [legacy, 'block.vue']]) {
    const { descriptor, errors } = parse(source, { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    const compiled = compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(compiled.errors, [])
  }
})
