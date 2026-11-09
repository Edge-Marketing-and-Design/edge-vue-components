// Static handler dependency tracing. Never require or execute application code.
const fs = require('node:fs')
const path = require('node:path')
const { analyze } = require('eslint-scope')
const { isBuiltin } = require('node:module')

const property = node => node?.computed ? (typeof node.property?.value === 'string' ? node.property.value : null) : node?.property?.name
const required = node => node?.type === 'CallExpression' && node.callee?.name === 'require' && typeof node.arguments[0]?.value === 'string' ? node.arguments[0].value : null
const exportName = (node) => {
  if (node?.type !== 'MemberExpression') return null
  if (node.object?.name === 'exports') return property(node)
  if (node.object?.object?.name === 'module' && property(node.object) === 'exports') return property(node)
  return null
}
const moduleExport = node => node?.object?.name === 'module' && property(node) === 'exports'

function createHandlerTracer({ root, asts, resolve, closure, hashFiles, digest, env, environmentNames, legacyV3 = false, legacyV4 = false, scopedRuntime = false, scopedTriggers = false, runtimeAssets = new Map() }) {
  const modules = new Map()
  function inspect(file) {
    if (modules.has(file)) return modules.get(file)
    const ast = asts.get(file)
    const info = { file, ast, source: fs.readFileSync(file, 'utf8'), exports: new Map(), bindings: new Map(), references: new Map(), init: [], imports: new Set(), execution: [], ambiguous: false }
    modules.set(file, info)
    if (!ast) return info
    const top = new Set()
    for (const statement of ast.body) {
      const node = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration' ? statement.declaration : statement
      if (node?.type === 'VariableDeclaration') node.declarations.forEach(d => top.add(d))
      else if (['FunctionDeclaration', 'ClassDeclaration'].includes(node?.type)) top.add(node)
    }
    try {
      const scopes = analyze(ast, { ecmaVersion: 2022, sourceType: ast.sourceType, nodejsScope: ast.sourceType !== 'module', optimistic: true, impliedStrict: true })
      for (const scope of scopes.scopes) {
        for (const variable of scope.variables) {
          const definitions = variable.defs.filter(d => top.has(d.node) || d.type === 'ImportBinding')
          if (definitions.length) info.bindings.set(variable, definitions[0])
        }
        for (const reference of scope.references) info.references.set(reference.identifier.start, reference)
      }
    } catch { info.ambiguous = true }
    function importOf(node) {
      const specifier = required(node)
      if (specifier) return { specifier, members: [] }
      if (node?.type === 'MemberExpression') {
        const base = importOf(node.object)
        if (base) return { ...base, members: [...base.members, property(node) || '*'] }
      }
      return null
    }
    info.importOf = importOf
    function addExport(name, value) {
      if (typeof name !== 'string' || !value || info.exports.has(name)) info.ambiguous = true
      else info.exports.set(name, value)
    }
    function descriptor(name, node) {
      const fields = node?.type === 'ObjectExpression' && node.properties
      const value = fields && fields.find(p => p.type === 'Property' && !p.computed && (p.key.name || p.key.value) === 'value')
      if (!value || fields.some(p => p.type !== 'Property' || p.computed || ['get', 'set'].includes(p.key.name || p.key.value))) info.ambiguous = true
      else addExport(name, value.value)
    }
    // A local require always executes module initialization, even if its binding
    // is unused. Do not visit deferred function bodies for initialization.
    function findImports(node) {
      if (!node || typeof node !== 'object') return
      if (['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(node.type)) return
      const specifier = required(node) || (node.type === 'ImportDeclaration' ? node.source.value : null)
        || (!legacyV3 && node.type === 'ImportExpression' && typeof node.source?.value === 'string' ? node.source.value : null)
      if (specifier) {
        info.execution.push([node.start, `import:${specifier}`])
        const dependency = resolve(file, specifier)
        if (dependency) info.imports.add(dependency)
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(findImports)
        else if (value && typeof value === 'object') findImports(value)
      }
    }
    for (const statement of ast.body) {
      findImports(statement)
      const assignment = statement.expression
      const exportDescriptors = assignment?.type === 'CallExpression' && assignment.callee?.object?.name === 'Object'
        && ['defineProperty', 'defineProperties'].includes(property(assignment.callee))
        && (assignment.arguments[0]?.name === 'exports' || moduleExport(assignment.arguments[0]))
      if (exportDescriptors) {
        if (property(assignment.callee) === 'defineProperty') descriptor(assignment.arguments[1]?.value, assignment.arguments[2])
        else if (assignment.arguments[1]?.type === 'ObjectExpression') {
          for (const p of assignment.arguments[1].properties) {
            if (p.type !== 'Property' || p.computed) info.ambiguous = true
            else descriptor(p.key.name || p.key.value, p.value)
          }
        } else info.ambiguous = true
      } else if (assignment?.type === 'AssignmentExpression' && moduleExport(assignment.left)) {
        if (assignment.right.type === 'ObjectExpression') {
          for (const p of assignment.right.properties) {
            const name = p.computed ? p.key?.value : p.key?.name || p.key?.value
            if (p.type !== 'Property' || typeof name !== 'string' || p.kind !== 'init') info.ambiguous = true
            else addExport(name, p.value)
          }
        } else info.exports.set('default', assignment.right)
      } else if (assignment?.type === 'AssignmentExpression' && exportName(assignment.left)) {
        const name = exportName(assignment.left)
        if (info.exports.has(name)) info.ambiguous = true
        info.exports.set(name, assignment.right)
      } else if (statement.type === 'ExportNamedDeclaration') {
        if (statement.declaration) {
          const declaration = statement.declaration
          if (declaration.id) info.exports.set(declaration.id.name, declaration.id)
          else for (const d of declaration.declarations || []) {
            if (d.id.type === 'Identifier') info.exports.set(d.id.name, d.id)
            else info.ambiguous = true
          }
        }
        for (const s of statement.specifiers || []) info.exports.set(s.exported.name, statement.source ? { reexport: statement.source.value, name: s.local.name } : s.local)
      } else if (statement.type === 'ExportDefaultDeclaration') {
        info.exports.set('default', statement.declaration)
      } else if (statement.type === 'ExportAllDeclaration') {
        info.ambiguous = true
      } else if (!['VariableDeclaration', 'FunctionDeclaration', 'ImportDeclaration', 'EmptyStatement'].includes(statement.type)) {
        info.init.push(statement)
        info.execution.push([statement.start, `statement:${digest(info.source.slice(statement.start, statement.end))}`])
      }
    }
    return info
  }

  // These existing Hub factories build local handler/serializer values. Their
  // definitions remain dependencies of their consumers; constructing a value
  // does not configure unrelated Functions. Match the resolved local export,
  // not just a callee name that another module could shadow.
  function localFactory(info, node) {
    if (legacyV3 || node?.type !== 'CallExpression' || node.callee?.type !== 'Identifier') return false
    const variable = info.references.get(node.callee.start)?.resolved
    const definition = info.bindings.get(variable)
    const imported = info.importOf(definition?.node?.init)
    if (!imported) {
      // Reviewed local MCP factory: reads its bundle and builds local closures
      // and caches, without configuring other Functions. Consumers still trace
      // its complete definition, including the bundled files.
      if (scopedRuntime && path.relative(root, info.file) === 'functions/cmsAgentMedia.js'
        && variable?.name === 'createAgentMedia' && definition?.node?.init?.type === 'ArrowFunctionExpression') {
        // This reviewed factory constructs deferred media operations. Refuse
        // the exception if immediate side-effect statements/calls are added.
        const factory = definition.node.init
        const localBody = factory.body.type === 'BlockStatement' && factory.body.body.every(statement =>
          statement.type === 'FunctionDeclaration'
          || (statement.type === 'VariableDeclaration' && statement.declarations.every(d => pureInitializer(d.init, info)))
          || (statement.type === 'ReturnStatement' && pureInitializer(statement.argument, info)))
        const localParams = factory.params.every(param => param.type === 'AssignmentPattern'
          && param.left.type === 'ObjectPattern' && pureInitializer(param.right, info)
          && param.left.properties.every(p => p.type === 'Property' && p.value.type === 'AssignmentPattern'
            && (pureInitializer(p.value.right, info)
              || (p.value.right.type === 'MemberExpression' && p.value.right.object.name === 'Date' && property(p.value.right) === 'now')
              || (p.value.right.type === 'CallExpression' && p.value.right.callee.name === 'createSourceFetcher' && !p.value.right.arguments.length))))
        return localBody && localParams
      }
      return !legacyV4 && path.relative(root, info.file) === 'functions/cmsAgentMcp.js'
        && variable?.name === 'createRemoteCms' && definition?.node?.init?.type === 'ArrowFunctionExpression'
    }
    let name = imported.members[0]
    if (definition.node.id?.type === 'ObjectPattern') {
      const p = definition.node.id.properties.find(p => p.value?.name === variable.name)
      name = p && !p.computed && (p.key.name || p.key.value)
    }
    const dependency = resolve(info.file, imported.specifier)
    const relative = dependency && path.relative(root, dependency)
    return (relative === 'functions/kv/kvMirror.js' && ['createKvMirrorHandler', 'createKvMirrorHandlerFromFields'].includes(name))
      || (relative === 'functions/kvAllowList.js' && name === 'kvAllowList')
  }
  // SDK trigger registration constructs a handler; it does not invoke its
  // callback during module initialization. Match resolved imports rather than
  // trusting an onCall/onMessagePublished spelling in arbitrary user code.
  const triggerNames = new Set(['onCall', 'onRequest', 'onSchedule', 'onMessagePublished',
    'onDocumentWritten', 'onDocumentCreated', 'onDocumentUpdated', 'onDocumentDeleted',
    'onDocumentUpdatedWithAuthContext', 'onObjectFinalized', 'onObjectDeleted'])
  function configuredSdkTrigger(info, value, name, seen = new Set()) {
    if (!value || seen.has(value)) return false
    seen.add(value)
    if (value.type === 'Identifier') {
      const variable = info.references.get(value.start)?.resolved
        || [...info.bindings.keys()].find(variable => variable.name === value.name)
      const def = info.bindings.get(variable)
      const imported = info.importOf(def?.node?.init)
      if (imported) {
        const members = [...imported.members]
        if (def.node.id?.type === 'ObjectPattern') {
          const binding = def.node.id.properties.find(p => p.type === 'Property' && !p.computed && p.value?.name === variable.name)
          if (!binding) return false
          members.push(binding.key.name || binding.key.value)
        }
        return /^firebase-functions\/v2\/(?:https|scheduler|pubsub|firestore|storage)$/.test(imported.specifier)
          && members.length === 1 && members[0] === name
      }
      return configuredSdkTrigger(info, def?.node?.init, name, seen)
    }
    const imported = info.importOf(value)
    if (imported) return /^firebase-functions\/v2\/(?:https|scheduler|pubsub|firestore|storage)$/.test(imported.specifier)
      && imported.members.length === 1 && imported.members[0] === name
    if (value.type === 'CallExpression' && value.callee.type === 'Identifier') {
      const def = info.bindings.get(info.references.get(value.callee.start)?.resolved)
      const wrapped = info.importOf(def?.node?.init)
      const wrapper = wrapped && resolve(info.file, wrapped.specifier)
      const binding = def?.node?.id?.properties?.find(p => p.type === 'Property' && p.value?.name === value.callee.name)
      const member = binding?.key?.name || wrapped?.members?.[0]
      return wrapper && path.relative(root, wrapper) === 'functions/errorReporting.js'
        && member === 'wrapTriggerFactory' && configuredSdkTrigger(info, value.arguments[0], name, seen)
    }
    return false
  }
  function triggerRegistration(node, info) {
    if (!scopedTriggers || node?.type !== 'CallExpression') return false
    const callee = node.callee
    const identifier = callee.type === 'MemberExpression' ? callee.object : callee
    if (identifier?.type !== 'Identifier') return false
    const variable = info.references.get(identifier.start)?.resolved
    const def = info.bindings.get(variable)
    const imported = info.importOf(def?.node?.init)
    if (!imported) return false
    let members = [...imported.members]
    if (def.node.id?.type === 'ObjectPattern') {
      const binding = def.node.id.properties.find(p => p.type === 'Property' && !p.computed && p.value?.name === variable.name)
      if (!binding) return false
      members.push(binding.key.name || binding.key.value)
    }
    if (callee.type === 'MemberExpression') members.push(property(callee))
    if (members.length !== 1 || !triggerNames.has(members[0])) return false
    const dependency = resolve(info.file, imported.specifier)
    const official = /^firebase-functions\/v2\/(?:https|scheduler|pubsub|firestore|storage)$/.test(imported.specifier)
    const configured = dependency && path.relative(root, dependency) === 'functions/config.js'
      && configuredSdkTrigger(inspect(dependency), inspect(dependency).exports.get(members[0]), members[0])
    return (official || configured) && node.arguments.every(argument => pureInitializer(argument, info))
  }
  const checkingPureCalls = new Set()
  function pureInitializer(node, info) {
    if (!node) return true
    if (triggerRegistration(node, info)) return true
    if (['FunctionExpression', 'ArrowFunctionExpression', 'Literal', 'Identifier'].includes(node.type)) return true
    // Import starts module initialization, which initialize()/hasStartupWork()
    // follow separately. Its exported values belong to the promise's consumer.
    if (!legacyV3 && node.type === 'ImportExpression' && typeof node.source?.value === 'string') return true
    if (!legacyV3 && !legacyV4 && node.type === 'SpreadElement') return pureInitializer(node.argument, info)
    if (node.type === 'ArrayExpression') return node.elements.every(child => pureInitializer(child, info))
    if (node.type === 'ObjectExpression') return node.properties.every(p => (p.type === 'Property' && !p.computed && pureInitializer(p.value, info))
      || (!legacyV3 && !legacyV4 && p.type === 'SpreadElement' && pureInitializer(p.argument, info)))
    if (['BinaryExpression', 'LogicalExpression'].includes(node.type)) return pureInitializer(node.left, info) && pureInitializer(node.right, info)
    if (node.type === 'UnaryExpression') return node.operator !== 'delete' && pureInitializer(node.argument, info)
    if (node.type === 'ConditionalExpression') return [node.test, node.consequent, node.alternate].every(child => pureInitializer(child, info))
    if (node.type === 'TemplateLiteral') return node.expressions.every(child => pureInitializer(child, info))
    if (node.type === 'MemberExpression' && node.object?.object?.name === 'process' && property(node.object) === 'env' && property(node)) return true
    if (!legacyV3 && !legacyV4 && node.type === 'CallExpression') {
      const object = node.callee?.object
      const definition = info.bindings.get(info.references.get(object?.start)?.resolved)
      const imported = info.importOf(definition?.node?.init)
      const pathCall = ['path', 'node:path'].includes(imported?.specifier)
        && !imported.members.length && ['join', 'resolve'].includes(property(node.callee))
      const importPromises = object?.name === 'Promise' && !info.references.get(object.start)?.resolved
        && property(node.callee) === 'all' && node.arguments.length === 1
        && node.arguments[0]?.type === 'ArrayExpression'
        && node.arguments[0].elements.every(child => child?.type === 'ImportExpression' && typeof child.source?.value === 'string')
      const literalJoin = object?.type === 'ArrayExpression' && property(node.callee) === 'join'
        && object.elements.every(child => child?.type === 'Literal')
      if (pathCall || importPromises || literalJoin) return node.arguments.every(child => pureInitializer(child, info))
      // Small expression-only local factories (for example docIdField) can be
      // proven here. Block bodies and recursive/unknown calls stay conservative.
      const calleeDefinition = info.bindings.get(info.references.get(node.callee?.start)?.resolved)
      const factory = calleeDefinition?.node?.init
      if (factory?.type === 'ArrowFunctionExpression' && !factory.async && factory.body.type !== 'BlockStatement'
        && !checkingPureCalls.has(factory)) {
        checkingPureCalls.add(factory)
        const pure = factory.params.every(param => param.type === 'Identifier'
          || (param.type === 'AssignmentPattern' && pureInitializer(param.right, info)))
          && pureInitializer(factory.body, info) && node.arguments.every(child => pureInitializer(child, info))
        checkingPureCalls.delete(factory)
        if (pure) return true
      }
    }
    const name = node.callee?.name
    const known = (node.type === 'NewExpression' && ['Set', 'Map', 'WeakMap', 'WeakSet', 'RegExp', 'Date'].includes(name))
      || (node.type === 'CallExpression' && (['defineSecret', 'Number', 'String', 'Boolean', 'parseInt', 'parseFloat'].includes(name)
        || (node.callee?.object?.name === 'Object' && ['freeze', 'seal'].includes(property(node.callee)))))
      || localFactory(info, node)
    return !!known && node.arguments.every(child => pureInitializer(child, info))
  }
  const startupCache = new Map()
  function hasStartupWork(file, visiting = new Set()) {
    if (startupCache.has(file)) return startupCache.get(file)
    if (visiting.has(file)) return true // Uncertain cycles stay conservative.
    const info = inspect(file)
    if (!legacyV3 && !legacyV4 && file.endsWith('.json')) return false
    if (!info.ast || info.ambiguous || info.init.length) return true
    for (const statement of info.ast.body) {
      const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
      if (declaration?.type === 'VariableDeclaration' && declaration.declarations.some(d => d.init && !info.importOf(d.init) && !pureInitializer(d.init, info))) return true
    }
    visiting.add(file)
    const result = info.execution.some(([, label]) => {
      if (!label.startsWith('import:')) return false
      const dependency = resolve(file, label.slice('import:'.length))
      return !dependency || hasStartupWork(dependency, visiting)
    })
    visiting.delete(file)
    startupCache.set(file, result)
    return result
  }

  return function trace(entry, entryPoint) {
    const pieces = new Map(), seen = new Set(), initialized = new Set(), initializationWork = new Set(), fallbacks = new Set(), environments = new Set(['NODE_ENV', 'FIREBASE_STORE_REGION', 'FIREBASE_STORAGE_BUCKET_REGION']), externals = new Set()
    const relative = file => path.relative(root, file)
    function piece(file, label, value) {
      pieces.set(`${relative(file)}:${label}`, [relative(file), label, hashFiles([file])[0]?.[1], digest(value)])
    }
    function fallback(file, reason) {
      fallbacks.add(`${relative(file)}: ${reason}`)
      for (const name of environmentNames || []) environments.add(name)
      for (const tuple of hashFiles([...closure(file)])) pieces.set(`whole:${tuple[0]}`, tuple)
    }
    function initialize(file) {
      if (initialized.has(file)) return
      initialized.add(file)
      const info = inspect(file)
      if (!legacyV3 && !legacyV4 && file.endsWith('.json')) return
      if (!info.ast || info.ambiguous) { initializationWork.add(file); fallback(file, 'unsupported module structure'); return }
      // A cached local require executes no second initialization. Built-in
      // imports are pure; retain ordering for fresh local work/external imports.
      const freshImports = new Set([...info.imports].filter(dependency => !initialized.has(dependency)))
      for (const dependency of info.imports) initialize(dependency)
      for (const statement of info.ast.body) {
        if (statement.type === 'ImportDeclaration' && !statement.specifiers.length && !resolve(file, statement.source.value)) externals.add(statement.source.value)
      }
      const occurrences = new Map()
      const execution = legacyV3 ? [...info.execution] : info.execution.filter(([, label]) => {
        if (!label.startsWith('import:')) return true
        const dependency = resolve(file, label.slice('import:'.length))
        if (scopedRuntime) return dependency ? freshImports.has(dependency) && initializationWork.has(dependency) : !isBuiltin(label.slice('import:'.length))
        return !dependency || hasStartupWork(dependency)
      })
      for (const node of info.init) {
        const source = info.source.slice(node.start, node.end)
        const key = digest(source), count = occurrences.get(key) || 0
        occurrences.set(key, count + 1)
        capture(file, node, `initialization:${key}:${count}`)
      }
      // Calls executed during variable initialization may change module/global
      // state. Trace them conservatively, but ignore pure declarations/imports.
      for (const statement of info.ast.body) {
        const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
        if (declaration?.type !== 'VariableDeclaration') continue
        for (const d of declaration.declarations) {
          const init = d.init
          if (!init || info.importOf(init)) continue
          if (!pureInitializer(init, info)) {
            const label = `initializer:${digest(info.source.slice(d.start, d.end))}`
            execution.push([d.start, label])
            capture(file, d, label)
          }
        }
      }
      if (execution.length) initializationWork.add(file)
      if (execution.length) piece(file, 'initialization-order', JSON.stringify(execution.sort(([a], [b]) => a - b).map(([, label]) => label)))
    }
    function followImport(file, specifier, members) {
      const dependency = resolve(file, specifier)
      if (dependency) followExport(dependency, members.length ? members : ['*'])
      else { externals.add(specifier); piece(file, `external:${specifier}:${members.join('.')}`, JSON.stringify([specifier, members])) }
    }
    function binding(file, variable, members = []) {
      const info = inspect(file), def = info.bindings.get(variable)
      if (!def) return
      const key = `${relative(file)}:binding:${variable.name}:${members.join('.')}`
      if (seen.has(key)) return
      seen.add(key)
      if (def.type === 'ImportBinding') {
        const specifier = def.parent.source.value
        const imported = def.node.type === 'ImportSpecifier' ? def.node.imported.name : def.node.type === 'ImportDefaultSpecifier' ? 'default' : '*'
        followImport(file, specifier, imported === '*' ? members : [imported, ...members])
        return
      }
      const imported = info.importOf(def.node.init)
      if (imported) {
        let importedName = []
        if (def.node.id.type === 'ObjectPattern') {
          const p = def.node.id.properties.find(p => p.value === def.name || p.value?.name === variable.name)
          if (!p || p.type !== 'Property' || p.computed || p.value.type !== 'Identifier') { fallback(file, 'unsupported import binding'); return }
          importedName = [p.key.name || p.key.value]
        } else if (def.node.id.type !== 'Identifier') { fallback(file, 'unsupported import destructuring'); return }
        followImport(file, imported.specifier, [...imported.members, ...importedName, ...members])
        return
      }
      capture(file, def.node, `binding:${variable.name}:${def.parent?.kind || def.type}`)
    }
    function followValue(file, node, members, label) {
      if (node?.reexport) { followImport(file, node.reexport, [node.name, ...members]); return }
      const info = inspect(file), imported = info.importOf(node)
      if (imported) { followImport(file, imported.specifier, [...imported.members, ...members]); return }
      if (node?.type === 'Identifier') {
        const ref = info.references.get(node.start)
        const variable = ref?.resolved || [...info.bindings.keys()].find(v => v.name === node.name)
        if (variable) { binding(file, variable, members); return }
      }
      if (node?.type === 'MemberExpression' && property(node)) {
        followValue(file, node.object, [property(node), ...members], label)
        return
      }
      if (members.length && node?.type === 'ObjectExpression') {
        const p = node.properties.find(p => p.type === 'Property' && !p.computed && (p.key.name || p.key.value) === members[0])
        if (p) { followValue(file, p.value, members.slice(1), `${label}.${members[0]}`); return }
      }
      if (!node) { fallback(file, 'missing export value'); return }
      capture(file, node, label)
    }
    function followExport(file, members) {
      initialize(file)
      const info = inspect(file), key = `${relative(file)}:export:${members.join('.')}`
      if (seen.has(key)) return
      seen.add(key)
      if (!legacyV3 && !legacyV4 && file.endsWith('.json')) {
        for (const tuple of hashFiles([file])) pieces.set(`asset:${tuple[0]}`, tuple)
        return
      }
      if (!info.ast || info.ambiguous) { fallback(file, 'unsupported exports'); return }
      if (members[0] === '*') {
        if (!info.exports.size) { fallback(file, 'opaque module value'); return }
        for (const name of info.exports.keys()) followExport(file, [name])
      } else if (info.exports.has(members[0])) {
        followValue(file, info.exports.get(members[0]), members.slice(1), `export:${members.join('.')}`)
      } else if (info.exports.has('default')) {
        followValue(file, info.exports.get('default'), members, `export:default.${members.join('.')}`)
      } else fallback(file, `unresolved export ${members[0]}`)
    }
    function capture(file, node, label) {
      const info = inspect(file), key = `${relative(file)}:capture:${label}`
      if (seen.has(key)) return
      seen.add(key)
      piece(file, label, info.source.slice(node.start, node.end))
      function visit(current, parent = null) {
        if (!current || typeof current !== 'object') return
        if (!legacyV3 && !legacyV4) {
          for (const tuple of hashFiles(runtimeAssets.get(`${file}:${current.start}`) || []))
            pieces.set(`asset:${tuple[0]}`, tuple)
        }
        if ((current.type === 'CallExpression' && ['eval', 'Function'].includes(current.callee?.name)) || (current.type === 'NewExpression' && current.callee?.name === 'Function')) fallback(file, 'dynamic code execution')
        if (current.type === 'MemberExpression' && current.object?.object?.name === 'process' && property(current.object) === 'env') {
          if (property(current)) environments.add(property(current))
          else fallback(file, 'dynamic environment lookup')
        }
        if (current.type === 'MemberExpression' && current.object?.type === 'Identifier') {
          const ref = info.references.get(current.object.start)
          const def = info.bindings.get(ref?.resolved)
          if (def && (info.importOf(def.node.init) || def.type === 'ImportBinding')) {
            binding(file, ref.resolved, [property(current) || '*'])
            if (current.computed) visit(current.property)
            return
          }
        }
        const specifier = required(current) || (current.type === 'ImportExpression' ? current.source?.value : null)
        if (typeof specifier === 'string') followImport(file, specifier, ['*'])
        if (current.type === 'Identifier') {
          const ref = info.references.get(current.start)
          if (ref?.resolved) binding(file, ref.resolved)
        }
        for (const value of Object.values(current)) {
          if (Array.isArray(value)) value.forEach(child => visit(child, current))
          else if (value && typeof value === 'object') visit(value, current)
        }
      }
      visit(node)
    }
    followExport(entry, entryPoint.split('.'))
    return {
      externals: [...externals].sort(),
      pieces: [...pieces.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
      environment: [...environments].sort().map(name => [name, digest(String(env[name] ?? ''))]),
      fallbacks: [...fallbacks].sort(),
    }
  }
}

module.exports = { createHandlerTracer }
