const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildInventory, VERSION } = require('../../scripts/function-deploy-plan.cjs')

function fixture(t, { trusted = true, eagerOptions = false, unsafeConfig = false } = {}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-trigger-scope-'))
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const write=(name,value)=>{fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),value)}
 write('functions/package.json','{"engines":{"node":"22"}}')
 write('functions/index.js',"exports.alpha=require('./alpha'); const {worker}=require('./worker'); exports.worker=worker")
 write('functions/config.js',unsafeConfig ? 'exports.onMessagePublished = callback => callback()' : "exports.onMessagePublished=require('firebase-functions/v2/pubsub').onMessagePublished")
 write('functions/pretend.js','exports.onMessagePublished = callback => callback()')
 write('functions/alpha.js','exports.one = () => 1')
 write('functions/helper.js','exports.value = 1')
 write('functions/worker.js',`const {onMessagePublished: register}=require('./${trusted?'config':'pretend'}'); const worker=register(${eagerOptions?'global.configure(), ':''}async ()=>{return require('./helper').value}); module.exports={worker}`)
 const endpoints={'alpha-one':{entryPoint:'alpha.one',platform:'gcfv2',region:['us-central1']},worker:{entryPoint:'worker',platform:'gcfv2',region:['us-central1']}}
 const inventory=()=>buildInventory(root,endpoints,{}, {formats:[7,VERSION]}).inventory
 const before=inventory()
 const changed=()=>{const after=inventory();return Object.entries(after).filter(([key,value])=>value.fingerprint!==before[key].fingerprint).map(([,value])=>value.name).sort()}
 return {write,changed,before,inventory}
}

test('deferred const trigger callback and helpers belong only to that trigger',t=>{
 const f=fixture(t)
 f.write('functions/helper.js','exports.value = 2')
 assert.deepEqual(f.changed(),['worker'])
 const after=f.inventory()
 assert.notEqual(after['us-central1/alpha-one'].handlerV7Fingerprint,f.before['us-central1/alpha-one'].handlerV7Fingerprint,'old v7 broad initialization remains reproducible for archive proof')
})

test('same-named factories from unrelated modules stay conservative',t=>{
 const f=fixture(t,{trusted:false})
 f.write('functions/helper.js','exports.value = 2')
 assert.deepEqual(f.changed(),['alpha-one','worker'])
})

test('a non-SDK config export is not accepted just because its name matches',t=>{
 const f=fixture(t,{unsafeConfig:true})
 f.write('functions/helper.js','exports.value = 2')
 assert.deepEqual(f.changed(),['alpha-one','worker'])
})

test('eager option calls still affect shared startup fingerprints',t=>{
 const f=fixture(t,{eagerOptions:true})
 f.write('functions/helper.js','exports.value = 2')
 assert.deepEqual(f.changed(),['alpha-one','worker'])
})

test('real global startup statements still affect unrelated handlers',t=>{
 const f=fixture(t)
 f.write('functions/helper.js','exports.value = 2; global.configure()')
 // The helper is a deferred require and is not loaded during module startup.
 assert.deepEqual(f.changed(),['worker'])
 f.write('functions/worker.js',"const {onMessagePublished}=require('./config'); require('./helper'); const worker=onMessagePublished(async()=>require('./helper').value); module.exports={worker}")
 assert.deepEqual(f.changed(),['alpha-one','worker'])
})

test('direct SDK namespace registrations with pure options isolate their callback too',t=>{
 const f=fixture(t)
 f.write('functions/worker.js',"const sdk=require('firebase-functions/v2/pubsub'); const worker=sdk.onMessagePublished({topic:'demo'},async()=>require('./helper').value); module.exports={worker}")
 const baseline=f.inventory()
 f.write('functions/helper.js','exports.value = 3')
 const changed=Object.entries(f.inventory()).filter(([key,value])=>value.fingerprint!==baseline[key].fingerprint).map(([,value])=>value.name).sort()
 assert.deepEqual(changed,['worker'])
})

test('trigger registration options remain dependencies of their registered endpoint',t=>{
 const f=fixture(t)
 f.write('functions/worker.js',"const {onMessagePublished}=require('./config'); const worker=onMessagePublished({topic:'changed'},async()=>require('./helper').value); module.exports={worker}")
 assert.deepEqual(f.changed(),['worker'])
})
