import assert from 'node:assert/strict'
import test from 'node:test'
import { inlineScriptFindings, validateBlock } from '../lib/cmsBlockValidation.js'

const findings = code => inlineScriptFindings(`<script>${code}</script>`)
test('direct popup initialization needs no warning and code is never executed', () => {
  assert.deepEqual(findings(`(() => {
    const popup = document.currentScript?.previousElementSibling;
    if (!popup?.matches('[data-fcti-popup]')) return;
    if (popup.dataset.fctiPopupInitialized === 'true') return;
    popup.dataset.fctiPopupInitialized = 'true';
    const readClosed = () => { try { return sessionStorage.getItem('closed') === 'true'; } catch { return false; } };
    popup.querySelector('button')?.addEventListener('click', () => popup.classList.remove('is-visible'));
    setTimeout(() => { if (popup.isConnected && !readClosed()) popup.classList.add('is-visible'); }, 3500);
  })();`), [])
  assert.deepEqual(findings('throw new Error("must never execute")'), [])
})
test('syntax failures are errors, not general script warnings', () => {
  const [issue] = findings('const broken = ;')
  assert.equal(issue.code, 'script.syntax')
  assert.equal(issue.severity, 'error')
  assert.match(issue.message, /Inline script 1.*Unexpected token/)
})
test('DOMContentLoaded-only initialization is warned about', () => {
  for (const code of [
    'document.addEventListener("DOMContentLoaded", init)',
    'window.addEventListener("DOMContentLoaded", () => init())',
    'document.addEventListener("DOMContentLoaded", () => { document.body.classList.add("ready") })',
    'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else unrelated();',
    'document.addEventListener("DOMContentLoaded", () => init()); window.addEventListener("DOMContentLoaded", () => init());',
  ]) assert.equal(findings(code)[0]?.code, 'script.dom-content-loaded-only')
})
test('readyState fallbacks and separate initialization are accepted', () => {
  for (const code of [
    'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();',
    'document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();',
    'init(); document.addEventListener("DOMContentLoaded", init);',
    'init(); document.addEventListener("DOMContentLoaded", () => init());',
    '// document.addEventListener("DOMContentLoaded", init)\nconst label = "DOMContentLoaded";',
    'button.addEventListener("DOMContentLoaded", init)',
  ]) assert.deepEqual(findings(code), [], code)
})
test('non-executable scripts, comments and external sources are not parsed', () => {
  assert.deepEqual(inlineScriptFindings(`<!-- <script>invalid @</script> -->
    <script type="application/ld+json">{"name":"Example"}</script>
    <script type="importmap">{"imports":{}}</script>
    <script src="/vendor.js">ignored invalid @</script>`), [])
  assert.deepEqual(inlineScriptFindings('<script type="module">export const value = await Promise.resolve(1)</script>'), [])
  assert.equal(inlineScriptFindings('<script type="module">export const = 1</script>')[0].code, 'script.syntax')
})
test('member-based initializers are recognized with the same receiver and property', () => {
  for (const code of [
    'document.addEventListener("DOMContentLoaded", app.init); app.init();',
    'document.addEventListener("DOMContentLoaded", app["init"]); app.init();',
    'document.addEventListener("DOMContentLoaded", app.ui.init); app.ui.init();',
    'document.addEventListener("DOMContentLoaded", () => app.init()); app.init();',
    'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", app.init); else app.init();',
  ]) assert.deepEqual(findings(code), [], code)
  for (const code of [
    'document.addEventListener("DOMContentLoaded", app.init); other.init();',
    'document.addEventListener("DOMContentLoaded", app.init); app.other();',
    'document.addEventListener("DOMContentLoaded", app.init); app[key]();',
  ]) assert.equal(findings(code)[0]?.code, 'script.dom-content-loaded-only', code)
})
test('calls in uninvoked functions or deferred callbacks do not count as initialization', () => {
  for (const code of [
    'document.addEventListener("DOMContentLoaded", init); function neverCalled() { init(); }',
    'document.addEventListener("DOMContentLoaded", init); const neverCalled = () => init();',
    'document.addEventListener("DOMContentLoaded", init); const neverCalled = function () { init(); };',
    'document.addEventListener("DOMContentLoaded", app.init); const app2 = { neverCalled() { app.init(); } };',
    'document.addEventListener("DOMContentLoaded", init); button.addEventListener("click", () => init());',
    'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else { function neverCalled() { init(); } }',
    'document.addEventListener("DOMContentLoaded", init); (function* () { init(); })();',
  ]) assert.equal(findings(code)[0]?.code, 'script.dom-content-loaded-only', code)
})
test('directly executed IIFEs still count as initialization', () => {
  for (const code of [
    'document.addEventListener("DOMContentLoaded", init); (() => { init(); })();',
    'document.addEventListener("DOMContentLoaded", app.init); (function () { app.init(); })();',
    '(() => { document.addEventListener("DOMContentLoaded", init); init(); })();',
    'document.addEventListener("DOMContentLoaded", init); (() => { (() => init())(); })();',
  ]) assert.deepEqual(findings(code), [], code)
  assert.equal(findings('(() => { document.addEventListener("DOMContentLoaded", init); function unused() { init(); } })();')[0]?.code, 'script.dom-content-loaded-only')
})
test('templated script syntax is deferred until hydrated', async () => {
  const template = '<section><script>const count = {{ count }};</script></section>'
  assert.deepEqual(inlineScriptFindings(template, { deferTemplated: true }), [])
  const doc = { name: 'Script', templateVersion: 2, template, content: template, schema: {}, dataSources: {}, values: {}, tags: [], themes: [], synced: true, version: 1 }
  const valid = await validateBlock(doc, { renderTemplate: () => template.replace('{{ count }}', '3') })
  assert.equal(valid.errors.some(issue => issue.code === 'script.syntax'), false)
  const invalid = await validateBlock(doc, { renderTemplate: () => template.replace('{{ count }}', '') })
  assert.equal(invalid.errors.some(issue => issue.code === 'script.syntax'), true)
})
test('static/rendered lifecycle findings are not duplicated', async () => {
  const template = '<script>document.addEventListener("DOMContentLoaded", init)</script>'
  const doc = { name: 'Script', templateVersion: 2, template, content: template, schema: {}, dataSources: {}, values: {}, tags: [], themes: [], synced: true, version: 1 }
  const result = await validateBlock(doc, { renderTemplate: () => template })
  assert.equal(result.warnings.filter(issue => issue.code === 'script.dom-content-loaded-only').length, 1)
})
