import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { pageRender, pageRenderPlaceHolder, renderTemplateAsync, prepareCollectionTemplate } from '@edgedev/template-engine'
import { prepareBlockForRender } from '../lib/cmsDataSourceRecords.js'
import { extractSourceCalls, validateBlock, validateBlockDocument } from '../lib/cmsBlockValidation.js'
import { extractSourceCalls as agentSourceCalls } from '../lib/cmsAgentReads.js'

const reference = await readFile(new URL('../skills/edge-block-package/reference/interactive-collections.md', import.meta.url), 'utf8')
const config = JSON.parse(reference.match(/```json\n([\s\S]*?)\n```/)[1])
const template = reference.match(/```html\n([\s\S]*?)\n```/)[1]
const doc = { docId:'interactive-catalog',id:'interactive-catalog',name:'Interactive Catalog',content:template,template,tags:[],themes:[],type:['Page'],synced:false,version:1,previewType:'light',...config }
const preparedDoc = prepareBlockForRender(doc,{orgId:'org',siteId:'site'})
const products = Array.from({length:26},(_,index)=>({ canonical:`products:org:site:${index}`,published:true,name:`Product ${String(index).padStart(2,'0')}`,url:`/products/${index}/`,categoryId:'books',tags:['reading'],privateField:'never-expose-this' }))
function fixture() {
  const listCalls=[]; const getCalls=[]
  const values = new Map(products.map(row=>[row.canonical,row]))
  values.set('categories:org:site:books',{docId:'books',name:'Books & More',published:true})
  const binding = {
    async list({prefix}) {
      listCalls.push(prefix)
      if(prefix.startsWith('idx:categories:published:org:site:true:'))return {keys:[{name:prefix+'books',metadata:{canonical:'categories:org:site:books',docId:'books',name:'Books & More'}}],list_complete:true}
      const rows = products.flatMap((row,index)=>['published','categoryId','tags'].flatMap(field=>(Array.isArray(row[field])?row[field]:[row[field]]).map(value=>({name:`idx:products:${field}:org:site:${value}:${index}`,metadata:{...row}}))))
      return {keys:rows.filter(row=>row.name.startsWith(prefix)),list_complete:true}
    },
    async get(key) {
      getCalls.push(key)
      const lookup=value=>values.has(value)?JSON.stringify(values.get(value)):null
      return Array.isArray(key)?new Map(key.map(value=>[value,lookup(value)])):lookup(key)
    },
  }
  return {binding,listCalls,getCalls}
}
const hydrated = fixture => ({uniqueKey:'org:site',clientOptions:{binding:fixture.binding}})

test('both validator and MCP source summaries recognize collection helpers in template order',()=>{
  const input='{{{#collectionFilter {"source":"agents","filter":"name"} }}} {{{#collectionOptions {"source":"offices","label":"name","value":"docId"} }}} {{#for x in source("states")}}{{ x }}{{/for}} {{{#collectionResults {"source":"agents"} }}}<p>x</p>{{{/collectionResults}}}'
  const expected=['agents','offices','states','agents']
  assert.deepEqual(extractSourceCalls(input),expected)
  assert.deepEqual(agentSourceCalls(input),expected)
})
test('malformed helper JSON is not silently counted as a valid source use',()=>{
  const input='{{{#collectionOptions {source:"offices"} }}}'
  assert.deepEqual(extractSourceCalls(input),[])
  assert.deepEqual(agentSourceCalls(input),[])
})
test('undeclared helper sources remain errors; unused real sources still warn',()=>{
  const result=validateBlockDocument({...doc,template:'{{{#collectionOptions {"source":"missing","label":"name","value":"id"} }}}',dataSources:{unused:{path:'products'}}})
  assert.ok(result.errors.some(issue=>issue.code==='sources.undeclared'))
  assert.ok(result.warnings.some(issue=>issue.code==='sources.unused'))
})
test('the complete documented example passes static and placeholder render validation',async()=>{
  const result=await validateBlock(doc,{renderTemplate:renderTemplateAsync})
  assert.deepEqual(result.errors,[])
  assert.ok(!result.warnings.some(issue=>['sources.unused','sources.loaded-token'].includes(issue.code)))
})
test('native results own the loaded wrapper; ordinary dynamic blocks still need loaded token',()=>{
  const result=validateBlockDocument({...doc,template:'<div>{{#for product in source("products")}}{{ product.name }}{{/for}}</div>',dataSources:{products:config.dataSources.products}})
  assert.ok(result.warnings.some(issue=>issue.code==='sources.loaded-token'))
})
test('documented helpers produce projected SSR results, dynamic escaped options and server page links',async()=>{
  const f=fixture()
  const result=await pageRender([{...preparedDoc,values:{__cmsCollectionRoute:{path:'/catalog/',query:{campaign:'example'}}}}],{},'',hydrated(f))
  assert.match(result.html,/Product 00/)
  assert.doesNotMatch(result.html,/never-expose-this/)
  assert.match(result.html,/<option value="books">Books &amp; More<\/option>/)
  assert.match(result.html,/catalog_page=2/)
  const state=JSON.parse(result.html.match(/data-cms-collection-state="products">([^<]*)<\/script>/)[1])
  assert.equal(state.result.total,26)
  assert.equal(state.result.items.length,24)
  assert.equal(state.result.pages,2)
  assert.equal(state.config.pagination.mode,'server')
  assert.ok(!('candidates' in state))
})
test('direct second-page SSR uses the authored page/filter parameters and preserves unrelated query',async()=>{
  const f=fixture()
  const result=await pageRender([{...preparedDoc,values:{__cmsCollectionRoute:{path:'/catalog/',query:{catalog_page:'2',campaign:'example'}}}}],{},'',hydrated(f))
  const state=JSON.parse(result.html.match(/data-cms-collection-state="products">([^<]*)<\/script>/)[1])
  assert.equal(state.result.page,2)
  assert.equal(state.result.items.length,2)
  assert.match(result.html,/Product 25/)
  assert.match(result.html,/campaign=example/)
})
test('empty results use item.total while bare total still fails the existing condition rule',async()=>{
  const f=fixture()
  const result=await pageRender([{...preparedDoc,values:{__cmsCollectionRoute:{path:'/catalog/',query:{catalog_name:'absent'}}}}],{},'',hydrated(f))
  assert.match(result.html,/No matching results/)
  const raw='{{{#if {"cond":"total == 0"} }}}empty{{{#else}}}not-empty{{{/if}}}'
  assert.equal(await renderTemplateAsync(raw,{total:0},{},{templateVersion:2}),'not-empty')
  assert.equal(await renderTemplateAsync(raw.replace('total ==','item.total =='),{total:0},{},{templateVersion:2}),'empty')
})
test('placeholder rendering does not fetch helper KV data and exposes its busy region',async()=>{
  const f=fixture()
  const result=await pageRenderPlaceHolder([doc],{},'')
  assert.match(result.html,/data-cms-collection-results="products" aria-busy="true"/)
  assert.doesNotMatch(result.html,/Product 00/)
  assert.equal(f.listCalls.length,0)
  assert.equal(f.getCalls.length,0)
})
test('inline results remain in the single template and require no second authored template field',()=>{
  const prepared=prepareCollectionTemplate(template,config.dataSources)
  assert.match(prepared.dataSources.products.interactive.template,/for product in items/)
  assert.equal(config.dataSources.products.interactive.template,undefined)
  assert.throws(()=>prepareCollectionTemplate('{{{/collectionResults}}}',config.dataSources),/Unmatched/)
})
test('root and Functions installs use the same published engine version',()=>{
  const root=createRequire(new URL('../../package.json',import.meta.url))
  const functions=createRequire(new URL('../../functions/package.json',import.meta.url))
  assert.equal(root('@edgedev/template-engine/package.json').version,functions('@edgedev/template-engine/package.json').version)
})
