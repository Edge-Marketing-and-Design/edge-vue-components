// __PROJECT_NAME__ — package __PACKAGE__.
// Run: node generate-package.mjs && node validate-package.mjs && node preview.mjs
// Templates and schemas live here; blocks/*.json and manifest.json are generated. Do not hand-edit generated files.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const writeJson = (relativePath, value) => {
  const outputPath = resolve(packageRoot, relativePath)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`)
}

export const themeId = '__THEME_ID__'
export const themeName = '__THEME_NAME__'
export const organizationId = '__ORG_ID__'
export const siteId = '__SITE_ID__'

// --- Markup (String.raw, Template v2 grammar) -------------------------------
const exampleMarkup = String.raw`<section class="bg-canvas px-6 py-20 font-sans text-text md:py-24">
  <div class="mx-auto w-full max-w-6xl">
    <p class="font-mono text-xs uppercase tracking-[0.2em] text-textMuted">{{ eyebrow }}</p>
    <h2 class="mt-4 max-w-3xl text-4xl font-bold leading-tight text-text">{{ heading }}</h2>
    <p class="mt-6 max-w-2xl text-lg leading-8 text-textMuted">{{ body }}</p>
    <div class="mt-12 grid gap-6 md:grid-cols-3">
      {{#for card in cards}}
        <article class="rounded-2xl border border-border bg-cardBg p-7">
          <h3 class="text-2xl font-bold text-text">{{ card.title }}</h3>
          <p class="mt-3 leading-7 text-textMuted">{{ card.body }}</p>
        </article>
      {{/for}}
    </div>
  </div>
</section>`

// --- Inputs -------------------------------------------------------------------
const schema = {
  eyebrow: { type: 'text', label: 'Eyebrow', value: 'EYEBROW' },
  heading: { type: 'text', label: 'Heading', value: 'Replace this heading.', required: true },
  body: { type: 'textarea', label: 'Body', value: 'Replace this with approved copy.' },
  cards: {
    type: 'array',
    label: 'Cards',
    value: [
      { title: 'First', body: 'Approved copy only.' },
      { title: 'Second', body: 'Approved copy only.' },
      { title: 'Third', body: 'Approved copy only.' },
    ],
    schema: {
      title: { type: 'text', label: 'Title' },
      body: { type: 'textarea', label: 'Body' },
    },
  },
}
const pickSchema = mapping => Object.fromEntries(Object.entries(mapping).map(([field, source]) => [field, structuredClone(schema[source])]))

const makeBlock = ({ docId, name, content, blockSchema, dataSources = {}, instructions, aiInstructions, tags, type = ['Page'], previewType = 'dark', synced = false, isOverrideBlock }) => ({
  docId,
  name,
  content,
  templateVersion: 2,
  template: content,
  schema: blockSchema,
  dataSources,
  values: {},
  Instructions: instructions,
  aiInstructions,
  tags,
  themes: themeId ? [themeId] : [],
  type,
  previewType,
  ...(isOverrideBlock === undefined ? {} : { isOverrideBlock }),
  synced,
  version: 1,
})

const blocks = [
  makeBlock({
    docId: '__BLOCK_PREFIX__-example-section',
    name: '__NAME_PREFIX__ Example Section',
    content: exampleMarkup,
    blockSchema: pickSchema({ eyebrow: 'eyebrow', heading: 'heading', body: 'body', cards: 'cards' }),
    instructions: 'What the editor should know: which inputs to fill, which media to upload, what must be confirmed before publication.',
    aiInstructions: 'What an agent must preserve and must not invent.',
    tags: ['Content'],
  }),
]

const manifest = {
  name: '__PROJECT_NAME__ __PACKAGE__ Template v2 block package',
  generatedAt: '__DATE__',
  targetOrganization: { id: organizationId },
  targetSite: { id: siteId },
  targetTheme: { id: themeId, name: themeName },
  sourceProvenance: [
    'Design or content source, with file names and dates',
  ],
  blocks: blocks.map(block => ({
    docId: block.docId,
    file: `blocks/${block.docId}.json`,
    name: block.name,
    importMode: 'import-as-new', // overwrite only for a stable id that already exists in the Hub
    synced: block.synced,
    ...(block.isOverrideBlock === undefined ? {} : { isOverrideBlock: block.isOverrideBlock }),
  })),
  pages: [],
  templates: [],
  media: [],
  dataSources: [],
  firebaseChanges: false,
  firestoreIndexChanges: false,
  kvIndexChanges: false,
  rendererChanges: false,
}

export { blocks, manifest }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  blocks.forEach(block => writeJson(`blocks/${block.docId}.json`, block))
  writeJson('manifest.json', manifest)
  console.log(`Generated ${manifest.blocks.length} blocks and no page artifact in ${packageRoot}`)
}
