import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../components/cms/blockEditor.vue', import.meta.url), 'utf8')

const getDataSourceWizardTemplate = () => {
  const start = source.indexOf('<edge-shad-dialog :key="`data-source-dialog-')
  const end = source.indexOf('</edge-shad-dialog>', start)

  assert.notEqual(start, -1, 'data source wizard dialog should exist')
  assert.notEqual(end, -1, 'data source wizard dialog should close')

  return source.slice(start, end)
}

test('tears down the previous data source editor before loading another source', () => {
  assert.match(source, /const openTemplateV2DataSourceWizardForEdit = async \(sourceName, source\) => \{\s+state\.dataSourceWizardOpen = false\s+state\.dataSourceWizardDraft = null\s+state\.dataSourceWizardKey \+= 1\s+await nextTick\(\)/)
})

test('uses wizard-specific form field names so prior source values are not restored', () => {
  const wizardTemplate = getDataSourceWizardTemplate()
  const staticNames = [...wizardTemplate.matchAll(/\sname="(dataSourceWizard|wizard)[^"]*"/g)]
  const dynamicNames = [...wizardTemplate.matchAll(/:name="`((?:dataSourceWizard|wizard)[^`]*)`"/g)]

  assert.deepEqual(staticNames, [])
  assert.ok(dynamicNames.length > 0)
  dynamicNames.forEach(([, name]) => {
    assert.match(name, /\$\{state\.dataSourceWizardKey\}/)
  })
})
