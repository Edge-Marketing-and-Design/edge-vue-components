import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../components/editor.vue', import.meta.url), 'utf8')

const getSetCollectionDataSource = () => {
  const start = source.indexOf('const setCollectionData = async () => {')
  const end = source.indexOf('\n}\n\nconst resetEditorState', start)

  assert.notEqual(start, -1, 'setCollectionData should exist')
  assert.notEqual(end, -1, 'setCollectionData should have a complete body')

  return source.slice(start, end + 2)
}

test('existing document editors load the full document even when collection data is cached', () => {
  const setCollectionDataSource = getSetCollectionDataSource()

  assert.match(setCollectionDataSource, /if \(props\.docId !== 'new'\) \{/)
  assert.match(setCollectionDataSource, /const docData = props\.loadDocument[\s\S]*?: await edgeFirebase\.getDocData\(collectionPath, props\.docId\)/)
  assert.match(setCollectionDataSource, /if \(!props\.loadDocument\) \{/)
  assert.match(setCollectionDataSource, /edgeFirebase\.data\[collectionPath\]\[props\.docId\] = edgeGlobal\.dupObject\(docData\)/)
  assert.match(setCollectionDataSource, /\.\.\.\(!props\.loadDocument \? \(edgeFirebase\.data\[collectionPath\] \|\| cachedCollection \|\| \{\}\) : \{\}\)/)
  assert.match(setCollectionDataSource, /\.\.\.\(state\.collectionData \|\| \{\}\),\s+\[props\.docId\]: docData/)
  assert.doesNotMatch(setCollectionDataSource, /if \(!edgeFirebase\.data\?\.\[collectionPath\]\)/)
})

test('a saved new document becomes the editor baseline before navigation', () => {
  assert.match(source, /savedDocId: ''/)
  assert.match(source, /const baselineDocId = props\.docId === 'new' \? state\.savedDocId : props\.docId/)
  assert.match(source, /state\.workingDoc = edgeGlobal\.dupObject\(savedDoc\)\s+await nextTick\(\)\s+const normalizedSavedDoc = edgeGlobal\.dupObject\(state\.workingDoc\)/)
  assert.match(source, /\[savedDocId\]: normalizedSavedDoc/)
  assert.match(source, /state\.savedDocId = savedDocId/)
})
