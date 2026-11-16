import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const loadConverter = () => {
  const source = readFileSync(new URL('../composables/useCmsTemplateV2Conversion.js', import.meta.url), 'utf8')
    .replace('export const useCmsTemplateV2Conversion =', 'const useCmsTemplateV2Conversion =')
  // eslint-disable-next-line no-new-func
  return new Function(`${source}; return useCmsTemplateV2Conversion;`)()
}

const { convertLegacyBlockToTemplateV2 } = loadConverter()()

test('converts collection arrays to named v2 data sources', () => {
  const result = convertLegacyBlockToTemplateV2(`{{{#array {"field":"agents","collection":{"path":"users","uniqueKey":"{orgId}","order":[{"field":"name","direction":"asc"}]},"queryOptions":[{"field":"office_id","title":"Office","options":"offices","optionsKey":"name","optionsValue":"mo_id"}],"queryItems":{"office_id":"bozeman"},"limit":12,"value":[]}}}}
  <h3>{{item.name}}</h3>
{{{/array}}}`)

  assert.equal(result.templateVersion, 2)
  assert.match(result.template, /{{#for item in source\("agents"\)}}/)
  assert.match(result.template, /{{ item.name }}/)
  assert.equal(result.dataSources.agents.type, 'collection')
  assert.equal(result.dataSources.agents.path, 'users')
  assert.equal(result.dataSources.agents.limit, 12)
  assert.equal(result.dataSources.agents.controls.office_id.label, 'Office')
  assert.equal(result.dataSources.agents.queryItems.office_id, 'bozeman')
  assert.deepEqual(result.values, {})
})

test('keeps data source query settings out of converted v2 values', () => {
  const result = convertLegacyBlockToTemplateV2({
    values: {
      mainHeader: 'Featured Montana Properties',
      showcaseproperties: ['placeholder'],
    },
    meta: {
      showcaseproperties: {
        queryItems: {
          'sort': 'listing_price',
          'filter_scope[agent_ids]': 'mt_nmar-mt.545503245',
          'filter_exact[state]': 'MT',
        },
        limit: 12,
      },
    },
    content: `{{{#text {"field":"mainHeader","value":"Featured Listings"}}}}
{{{#array {"field":"showcaseproperties","api":"https://example.com/properties","apiField":"data","queryOptions":[{"field":"sort","options":[{"label":"Highest Price","value":"listing_price"}]},{"field":"filter_exact[state]","input":"text","title":"State"}],"limit":6,"value":[]}}}}
  <h3>{{item.display_address}}</h3>
{{{/array}}}`,
  })

  assert.equal(result.schema.mainHeader.value, 'Featured Montana Properties')
  assert.deepEqual(result.values, {})
})

test('converts manual arrays to v2 schema defaults', () => {
  const result = convertLegacyBlockToTemplateV2(`{{{#array {"field":"featureLinks","schema":{"label":"text","url":"text"},"value":[{"label":"One","url":"/one"}]}}}}
  <a href="{{item.url}}">{{item.label}}</a>
{{{/array}}}`)

  assert.match(result.template, /{{#for item in featureLinks}}/)
  assert.deepEqual(result.schema.featureLinks.schema, {
    label: { type: 'text', label: 'Label' },
    url: { type: 'text', label: 'Url' },
  })
  assert.deepEqual(result.schema.featureLinks.value, [{ label: 'One', url: '/one' }])
  assert.deepEqual(result.values, {})
})

test('uses saved legacy values as v2 schema defaults when converting a block document', () => {
  const result = convertLegacyBlockToTemplateV2({
    values: {
      ctaText: 'Stake Your Claim',
      navItems: [
        { label: 'Properties', url: '#', active: 'true' },
        { label: 'Agents', url: '#', active: 'false' },
      ],
    },
    content: `<a>{{{#text {"field":"ctaText","title":"CTA Text","value":"Fallback"}}}}</a>
{{{#array {"field":"navItems","title":"Navigation Items","schema":[{"field":"label","type":"text","title":"Label"},{"field":"url","type":"text","title":"URL"},{"field":"active","type":"option","title":"Active","option":{"optionsKey":"title","optionsValue":"value","options":[{"title":"Yes","value":"true"},{"title":"No","value":"false"}]}}],"value":[]}}}}
  <a href="{{item.url}}">{{item.label}}</a>
{{{/array}}}`,
  })

  assert.equal(result.schema.ctaText.value, 'Stake Your Claim')
  assert.deepEqual(result.schema.navItems.value, [
    { label: 'Properties', url: '#', active: 'true' },
    { label: 'Agents', url: '#', active: 'false' },
  ])
  assert.deepEqual(result.values, {})
})

test('keeps choices, validation and tags on legacy array item inputs (Contact Us shape)', () => {
  const fieldType = { field: 'fieldType', options: [{ title: 'Text', name: 'text' }, { title: 'Email', name: 'email' }, { title: 'Phone', name: 'tel' }, { title: 'Textarea', name: 'textarea' }], optionsKey: 'title', optionsValue: 'name' }
  const required = { field: 'required', options: [{ title: 'Yes', name: 'true' }, { title: 'No', name: 'false' }], optionsKey: 'title', optionsValue: 'name' }
  const legacySchema = [
    { field: 'label', type: 'text', title: 'Label', validation: { required: true }, tags: ['form'] },
    { field: 'fieldType', type: 'text', title: 'Field Type', option: fieldType, value: 'text' },
    { field: 'required', type: 'text', title: 'Required', option: required, value: 'false' },
  ]
  const result = convertLegacyBlockToTemplateV2(`<form>{{{#array {"field":"fields","title":"Form Fields","schema":${JSON.stringify(legacySchema)},"value":[{"label":"Name","fieldType":"text","required":"true"}]}}}}
  <label>{{item.label}}<input type="{{item.fieldType}}" data-required="{{item.required}}"></label>
{{{/array}}}</form>`)

  const itemSchema = result.schema.fields.schema
  assert.deepEqual(itemSchema.fieldType, { type: 'text', label: 'Field Type', option: fieldType, value: 'text' })
  assert.deepEqual(itemSchema.required, { type: 'text', label: 'Required', option: required, value: 'false' })
  assert.deepEqual(itemSchema.label.validation, { required: true })
  assert.deepEqual(itemSchema.label.tags, ['form'])
  // A copy, not the parsed legacy object.
  itemSchema.fieldType.option.options.push({ title: 'Extra', name: 'extra' })
  assert.equal(fieldType.options.length, 4)
})

test('keeps choices on object-form legacy array item inputs', () => {
  const result = convertLegacyBlockToTemplateV2(`{{{#array {"field":"navItems","schema":{"label":"text","active":{"type":"option","title":"Active","option":{"options":[{"title":"Yes","value":"true"}],"optionsKey":"title","optionsValue":"value"},"value":"true"}},"value":[]}}}}
  <a>{{item.label}}</a>
{{{/array}}}`)

  assert.deepEqual(result.schema.navItems.schema.active.option.options, [{ title: 'Yes', value: 'true' }])
  assert.equal(result.schema.navItems.schema.active.value, 'true')
})

test('converts named subarrays to nested v2 loops', () => {
  const result = convertLegacyBlockToTemplateV2(`{{{#array {"field":"offices","value":[{"agents":[]}]}}}}
  {{{#subarray:agent {"field":"item.agents","limit":2}}}}
    <span>{{agent.name}}</span>
  {{{/subarray}}}
{{{/array}}}`)

  assert.match(result.template, /{{#for agent in item\.agents, \{ limit: 2 \}}}/)
  assert.match(result.template, /{{ agent.name }}/)
  assert.deepEqual(result.conversion.warnings, [])
})

test('keeps loading state tokens as unscoped template tokens', () => {
  const result = convertLegacyBlockToTemplateV2(`{{{#array {"field":"property","api":"https://example.com","value":[]}}}}
  <div class="{{loading}}"></div>
  <div class="{{ loaded }}"></div>
{{{/array}}}`)

  assert.match(result.template, /class="{{ loading }}"/)
  assert.match(result.template, /class="{{ loaded }}"/)
  assert.equal(result.schema.loading, undefined)
  assert.equal(result.schema.loaded, undefined)
})

test('converts nav collection source and keeps entries as a loop control', () => {
  const result = convertLegacyBlockToTemplateV2(`<nav data-position="{{{#text {"field":"navPosition","title":"Menu Position","option":{"field":"navPosition","options":[{"title":"Right","name":"right"},{"title":"Left","name":"left"}],"optionsKey":"title","optionsValue":"name"},"value":"right"}}}}">
  {{{#array {"field":"siteDoc","collection":{"path":"sites","canonicalLookup":{"key":"{orgId}:{siteId}"},"order":[]},"value":[]}}}}
    {{{#subarray:menuItem {"field":"item.menus.Site Root","limit":5,"value":[]}}}}
      {{{#if {"cond":"menuItem.name"} }}}
        <a>{{menuItem.name}}</a>
      {{{#else}}}
        {{{#entries:folderEntry {"field":"menuItem.item","value":{}}}}}
          <section>{{folderEntry.key}}</section>
          {{{#subarray:child {"field":"item.value","value":[]}}}}
            <a>{{child.name}}</a>
          {{{/subarray}}}
        {{{/entries}}}
      {{{/if}}}
    {{{/subarray}}}
  {{{/array}}}
</nav>`)

  assert.equal(result.schema.navPosition.type, 'text')
  assert.equal(result.schema.navPosition.value, 'right')
  assert.equal(result.dataSources.siteDoc.type, 'collection')
  assert.equal(result.dataSources.siteDoc.path, 'sites')
  assert.deepEqual(result.dataSources.siteDoc.canonicalLookup, { key: '{orgId}:{siteId}' })
  assert.equal(result.schema['menuItem.item'], undefined)
  assert.match(result.template, /{{#for item in source\("siteDoc"\)}}/)
  assert.match(result.template, /{{#for menuItem in item\.menus\.Site Root, \{ limit: 5 \}}}/)
  assert.match(result.template, /\{\{\{#entries:folderEntry \{"field":"menuItem\.item","value":\{\}\}\}\}\}/)
  assert.match(result.template, /{{ folderEntry.key }}/)
  assert.match(result.template, /{{ menuItem.name }}/)
  assert.doesNotMatch(result.template, /folderEntry\.menuItem/)
  assert.match(result.template, /{{#for child in folderEntry\.value}}/)
  assert.match(result.template, /{{ child.name }}/)
  assert.deepEqual(result.conversion.warnings, [])
})

test('renames duplicate explicit subarray aliases throughout the converted body', () => {
  const result = convertLegacyBlockToTemplateV2(`{{{#array {"field":"siteDoc","collection":{"path":"sites"},"value":[]}}}}
  {{{#subarray:menuItem {"field":"item.menus.Site Root","limit":5,"value":[]}}}}
    <span>{{menuItem.name}}</span>
  {{{/subarray}}}
  {{{#subarray:menuItem {"field":"item.menus.Site Root","value":[]}}}}
    {{{#if {"cond":"menuItem.item.type == 'external'"}}}}
      <a href="{{menuItem.item.url}}">{{menuItem.name}}</a>
    {{{#else}}}
      {{{#entries:folderEntry {"field":"menuItem.item","value":{}}}}}
        {{{#subarray:folderChild {"field":"item.value","value":[]}}}}
          {{{#if {"cond":"folderChild.menuTitle"}}}}
            <a href="/{{folderEntry.key}}/{{folderChild.name}}">{{folderChild.menuTitle}}</a>
          {{{/if}}}
        {{{/subarray}}}
      {{{/entries}}}
    {{{/if}}}
  {{{/subarray}}}
{{{/array}}}`)

  assert.match(result.template, /{{#for menuItem in item\.menus\.Site Root, \{ limit: 5 \}}}/)
  assert.match(result.template, /{{#for menuItem2 in item\.menus\.Site Root}}/)
  assert.match(result.template, /\{\{\{#if \{"cond":"menuItem2\.item\.type == 'external'"\}\}\}\}/)
  assert.match(result.template, /href="{{ menuItem2\.item\.url }}"/)
  assert.match(result.template, /{{ menuItem2\.name }}/)
  assert.match(result.template, /\{\{\{#entries:folderEntry \{"field":"menuItem2\.item","value":\{\}\}\}\}\}/)
  assert.match(result.template, /{{#for folderChild in folderEntry\.value}}/)
  assert.match(result.template, /\{\{\{#if \{"cond":"folderChild\.menuTitle"\}\}\}\}/)
  assert.match(result.template, /{{ folderChild\.menuTitle }}/)
  assert.doesNotMatch(result.template, /menuItem2\.menuItem/)
  assert.doesNotMatch(result.template, /folderChild\.folderChild/)
  assert.doesNotMatch(result.template, /{{#for folderChild in item\.value}}/)
})

test('generates deterministic aliases for unnamed subarrays', () => {
  const result = convertLegacyBlockToTemplateV2(`{{{#array {"field":"offices","value":[{"children":[]}]}}}}
  {{{#subarray {"field":"item.children"}}}}
    <span>{{item.name}}</span>
  {{{/subarray}}}
{{{/array}}}`)

  assert.match(result.template, /{{#for child in item.children}}/)
  assert.match(result.template, /{{ child.name }}/)
})

test('converts simple image text and richtext fields in visible markup', () => {
  const result = convertLegacyBlockToTemplateV2(`<section>
  <img src="{{{#image {"field": "backgroundImage", "value": "https://example.com/image.jpg" }}}}" />
  <h2>{{{#text {"field": "header", "value": "" }}}}</h2>
  <div>{{{#richtext {"field": "content", "value": "" }}}}</div>
</section>`)

  assert.match(result.template, /src="{{ backgroundImage }}"/)
  assert.match(result.template, /<h2>{{ header }}<\/h2>/)
  assert.match(result.template, /<div>{{ richtext\(content\) }}<\/div>/)
  assert.equal(result.schema.backgroundImage.type, 'image')
  assert.equal(result.schema.backgroundImage.value, 'https://example.com/image.jpg')
  assert.equal(result.schema.header.type, 'text')
  assert.equal(result.schema.header.value, '')
  assert.equal(result.schema.content.type, 'richtext')
  assert.equal(result.schema.content.value, '')
  assert.deepEqual(result.values, {})
})

test('recovers legacy tag configs with unquoted object keys', () => {
  const result = convertLegacyBlockToTemplateV2(`<a href="{{{#text {"field": "buttonURL", title: "Button URL", "value": "" }}}}">
  {{{#text {"field":"buttonText","value":"Let's Get Started"}}}}
</a>`)

  assert.match(result.template, /href="{{ buttonURL }}"/)
  assert.match(result.template, /{{ buttonText }}/)
  assert.equal(result.schema.buttonURL.type, 'text')
  assert.equal(result.schema.buttonURL.label, 'Button URL')
  assert.equal(result.schema.buttonURL.value, '')
  assert.equal(result.schema.buttonText.value, 'Let\'s Get Started')
  assert.deepEqual(result.conversion.warnings, [])
})

test('converts legacy publication tags to v2 publication markers and input settings', () => {
  const result = convertLegacyBlockToTemplateV2(`<section>
  {{{#publication {"field":"publicationPages","title":"Publication Pages","effect":"slide","value":{"page1":{"public":"https://example.com/page-1.jpg"}}}}}}
</section>`)

  assert.match(result.template, /\{\{\{#publication \{"field":"publicationPages"\}\}\}\}/)
  assert.equal(result.schema.publicationPages.type, 'publication')
  assert.equal(result.schema.publicationPages.label, 'Publication Pages')
  assert.equal(result.schema.publicationPages.effect, 'slide')
  assert.deepEqual(result.schema.publicationPages.value, {
    page1: {
      public: 'https://example.com/page-1.jpg',
    },
  })
  assert.deepEqual(result.values, {})
})

test('uses saved legacy publication values as v2 publication defaults', () => {
  const result = convertLegacyBlockToTemplateV2({
    values: {
      publicationPages: {
        savedPage: {
          public: 'https://example.com/saved.jpg',
        },
      },
    },
    content: '{{{#publication {"field":"publicationPages","effect":"flip","value":{}}}}}',
  })

  assert.equal(result.template, '{{{#publication {"field":"publicationPages"}}}}')
  assert.equal(result.schema.publicationPages.type, 'publication')
  assert.equal(result.schema.publicationPages.effect, 'flip')
  assert.deepEqual(result.schema.publicationPages.value, {
    savedPage: {
      public: 'https://example.com/saved.jpg',
    },
  })
  assert.deepEqual(result.values, {})
})
