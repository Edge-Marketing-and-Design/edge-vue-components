import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderTemplateAsync } from '@edgedev/template-engine'
import { validateEditorBlock } from '../lib/cmsBlockEditorChecks.js'

const template = '<section class="bg-action hover:bg-actionHover border-highlight text-textBody">Hello</section>'
const block = (overrides = {}) => ({ name: 'Test', templateVersion: 2, content: template, template, schema: {}, dataSources: {}, values: {}, tags: [], themes: ['custom'], synced: false, version: 1, ...overrides })
const themes = {
  custom: { name: 'Custom', theme: JSON.stringify({ extend: { colors: { action: '#000', actionHover: '#111', highlight: '#222', textBody: '#333' } } }) },
  standard: { name: 'Standard', theme: '{}' },
}
const check = doc => validateEditorBlock(doc, { themes, knownThemeIds: Object.keys(themes), renderTemplate: renderTemplateAsync })

test('editor accepts custom tokens in allowed themes, ignoring unrelated themes', async () => {
  const result = await check(block())
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
})
test('editor names the allowed theme that lacks custom tokens', async () => {
  const result = await check(block({ themes: ['custom', 'standard'] }))
  const warnings = result.warnings.filter(issue => issue.code === 'theme.color-name')
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].themeId, 'standard')
  assert.equal(warnings[0].severity, 'warning')
  assert.match(warnings[0].message, /Standard.*action, actionHover, highlight, textBody/)
})
test('editor preserves generic checks without allowed themes and uncertainty for missing themes', async () => {
  assert.ok((await check(block({ themes: [] }))).warnings.some(issue => issue.code === 'theme.color-name'))
  const missing = await check(block({ themes: ['missing'] }))
  assert.ok(missing.warnings.some(issue => issue.code === 'themes.unknown'))
  assert.ok(missing.warnings.some(issue => /unavailable; cannot verify/.test(issue.message)))
})
test('override advice skips all content checks and never renders', async () => {
  const result = await validateEditorBlock(block({ isOverrideBlock: true, template: '<script>const x = ;</script>', schema: null }), {
    renderTemplate: () => { throw new Error('Must not render an override') },
  })
  assert.equal(result.contentChecksSkipped, 'override')
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
})
test('normal editor blocks retain JavaScript checks, including after unchecking override', async () => {
  for (const isOverrideBlock of [false, undefined]) {
    const syntax = await check(block({ isOverrideBlock, content: '<script>const x = ;</script>', template: '<script>const x = ;</script>' }))
    assert.ok(syntax.errors.some(issue => issue.code === 'script.syntax'))
    const lifecycle = await check(block({ isOverrideBlock, content: '<script>document.addEventListener("DOMContentLoaded", init)</script>', template: '<script>document.addEventListener("DOMContentLoaded", init)</script>' }))
    assert.ok(lifecycle.warnings.some(issue => issue.code === 'script.dom-content-loaded-only'))
    const direct = await check(block({ isOverrideBlock, content: '<script>init()</script>', template: '<script>init()</script>' }))
    assert.equal(direct.warnings.some(issue => issue.code.startsWith('script.') || issue.code === 'grammar.script'), false)
  }
})
test('editor wires saved checks to theme-aware helper and labels overrides accurately', async () => {
  const source = await readFile(new URL('../components/cms/blockEditor.vue', import.meta.url), 'utf8')
  assert.match(source, /validateEditorBlock\(edgeGlobal\.dupObject\(doc/)
  assert.match(source, /themes: edgeFirebase\.data\?\.\[/)
  assert.match(source, /Block checks: skipped for override block/)
  assert.match(source, /Content checks skipped for this override block/)
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'editor-checks' })
  const compiled = compileTemplate({ source: descriptor.template.content, filename: 'blockEditor.vue', id: 'editor-checks', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(compiled.errors, [])
})

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const editorSource = await read('../components/cms/blockEditor.vue')
const managerSource = await read('../components/cms/blocksManager.vue')
const issuesSource = await read('../components/cms/blockValidationIssues.vue')

const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))

test('block checks run after a completed save, never inside the save path', () => {
  const saved = section(editorSource, 'const handleBlockSaved = async (payload) => {', '\n}\n')
  assert.match(saved, /^const handleBlockSaved = async \(payload\) => \{\n {2}runBlockChecks\(payload\?\.data\)/)
  assert.doesNotMatch(saved, /await runBlockChecks/, 'checks do not delay the rest of the saved handler')
  const saveHandler = section(editorSource, 'const writeBlockDoc', 'const discardUnreleasedChanges')
  assert.match(saveHandler, /const saveBlockDoc = async \(doc\) =>/)
  assert.doesNotMatch(saveHandler, /validateBlock|runBlockChecks/, 'the write path does not wait for checks')
})

test('block checks validate a copy with the org themes, tag list and the template engine', () => {
  const runner = section(editorSource, 'const runBlockChecks = async (doc) => {', '\n}\n')
  assert.match(runner, /validateEditorBlock\(edgeGlobal\.dupObject\(doc \|\| \{\}\), \{\s*themes: edgeFirebase\.data\?\.\[.*\] \|\| \{\},\s*knownThemeIds: availableThemeIds\.value,\s*blockTagList: blockTagList\.value,\s*renderTemplate: renderTemplateAsync,/)
  assert.match(runner, /if \(run === blockChecksRun\)\s*state\.blockChecks = \{ status: 'done'/, 'a newer run replaces an older one')
  assert.match(runner, /status: 'failed'/, 'a check failure is shown, not thrown')
})

test('the block checks dialog covers idle, running, failed, no-issue and issue states', () => {
  const dialog = section(editorSource, '<edge-shad-dialog v-model="state.blockChecksOpen">', '</edge-shad-dialog>')
  for (const text of ['Save the block to run its checks.', 'Running checks...', 'The checks could not run:', 'No issues found at', 'error(s) and'])
    assert.ok(dialog.includes(text), text)
  assert.match(dialog, /aria-live="polite"/)
  assert.match(dialog, /<edge-cms-block-validation-issues :issues="blockCheckIssues" \/>/)
})

test('the header button announces the check state', () => {
  assert.match(editorSource, /:aria-label="blockChecksLabel"\s+@click="state\.blockChecksOpen = true"/)
  for (const label of ['Block checks: running', 'Block checks: could not run', 'Block checks: save to run', 'Block checks: no issues'])
    assert.ok(editorSource.includes(label), label)
})

test('import review and block checks share one findings list', () => {
  assert.match(managerSource, /<edge-cms-block-validation-issues class="mt-2" :issues="item\.notices" \/>/)
  assert.match(issuesSource, /\{\{ issue\.severity \}\}/)
  assert.match(issuesSource, /\{\{ issue\.message \}\}/)
  assert.match(issuesSource, /\{\{ issue\.code \}\}/)
  assert.match(issuesSource, /issue\.path/)
})
