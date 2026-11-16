import assert from 'node:assert/strict'
import test from 'node:test'
import { pageRender } from '@edgedev/template-engine'

// A boolean field of a loop record is tested by presence ("office.isAgentLocation"),
// not with "== true", which the public renderer's engine never matches. Kept
// from the retired Clearwater offices package tests (its files were removed
// with the other temporary import packages, cadb113b).
test('installed public template evaluator recognizes a loop presence check, not boolean equality', async () => {
  const renderCondition = async condition => pageRender([{
    templateVersion: 2,
    values: { offices: [{ isAgentLocation: true }] },
    template: `{{#for office in item.offices}}{{{#if {"cond":"${condition}"} }}}agent-location{{{#else}}}office{{{/if}}}{{/for}}`,
  }], {}, '')

  const presenceResult = await renderCondition('office.isAgentLocation')
  const equalityResult = await renderCondition('office.isAgentLocation == true')

  assert.equal(presenceResult.html, 'agent-location')
  assert.equal(equalityResult.html, 'office')
})
