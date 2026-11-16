import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readProjectFile = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const [sideBarContentSource, sideBarSource] = await Promise.all([
  readProjectFile('edge/components/sideBarContent.vue'),
  readProjectFile('edge/components/sideBar.vue'),
])

test('secondary submenu titles wrap to two centered lines', () => {
  assert.match(sideBarContentSource, /submenu\s*\? 'line-clamp-2 !whitespace-normal !text-clip text-center text-\[10px\] leading-\[1\.1\]'/)
})

test('secondary submenu buttons can grow beyond their minimum height', () => {
  assert.match(sideBarSource, /gap-0 min-h-\[52px\] !h-auto py-1/)
  assert.doesNotMatch(sideBarSource, /:button-classes="`gap-0 h-\[52px\]/)
})
