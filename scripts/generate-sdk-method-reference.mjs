import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const cwd = process.cwd()
const sourceFiles = [
  'src/index.ts',
  'src/client.ts',
  'src/db/module.ts',
  'src/auth/types.ts',
  'src/storage/module.ts',
  'src/react/index.ts',
  'src/react/query-client.ts',
  'src/react/provider.ts',
  'src/react/use-query.ts',
  'src/react/use-mutation.ts',
  'src/react/use-session.ts',
  'src/react/use-athena-session-client.ts',
  'src/next/client.ts',
  'src/next/server.ts',
  'src/cookies/index.ts',
  'src/utils/index.ts',
  'src/auxiliaries.ts',
]

const program = ts.createProgram(sourceFiles.map(file => path.join(cwd, file)), {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  esModuleInterop: true,
  skipLibCheck: true,
  types: ['node'],
})
const checker = program.getTypeChecker()

function getSource(file) {
  const source = program.getSourceFile(path.join(cwd, file))
  if (!source) {
    throw new Error(`Missing source file: ${file}`)
  }
  return source
}

function findNode(source, predicate) {
  let found
  function walk(node) {
    if (found) return
    if (predicate(node)) {
      found = node
      return
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  return found
}

function findInterface(sourceFile, name) {
  return findNode(sourceFile, node => ts.isInterfaceDeclaration(node) && node.name.text === name)
}

function findClass(sourceFile, name) {
  return findNode(sourceFile, node => ts.isClassDeclaration(node) && node.name?.text === name)
}

function getDocumentation(symbol) {
  if (!symbol) return ''
  return ts.displayPartsToString(symbol.getDocumentationComment(checker)).replace(/\s+/g, ' ').trim()
}

function getJsDocTagText(text) {
  if (typeof text === 'string') return text
  if (!Array.isArray(text)) return ''
  return text
    .map(part => (typeof part === 'string' ? part : part.text ?? ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function getDeprecatedNotice(symbol) {
  if (!symbol || typeof symbol.getJsDocTags !== 'function') return ''
  const tag = symbol.getJsDocTags().find(candidate => candidate.name === 'deprecated')
  if (!tag) return ''
  return getJsDocTagText(tag.text) || 'This API is deprecated.'
}

function getTypeText(type, contextNode) {
  return checker.typeToString(
    type,
    contextNode,
    ts.TypeFormatFlags.NoTruncation |
      ts.TypeFormatFlags.UseFullyQualifiedType |
      ts.TypeFormatFlags.MultilineObjectLiterals,
  )
}

function sanitizeSignature(signature) {
  return signature
    .replace(/import\\(\"[^\\\"]+\"\\)\\./g, '')
    .replace(/\\s+/g, ' ')
    .trim()
}

function isLocalDeclaration(decl) {
  if (!decl) return false
  const source = decl.getSourceFile().fileName.replace(/\\/g, '/')
  return source.includes('/src/')
}

function collectInterfaceMethods(sourceFilePath, interfaceName, prefix, options = {}) {
  const { recursive = true } = options
  const source = getSource(sourceFilePath)
  const iface = findInterface(source, interfaceName)
  if (!iface) {
    throw new Error(`Interface not found: ${interfaceName} in ${sourceFilePath}`)
  }

  const ifaceType = checker.getTypeAtLocation(iface.name)
  const results = []
  const seen = new Set()

  function walkType(type, currentPath) {
    for (const prop of checker.getPropertiesOfType(type)) {
      const decl = prop.valueDeclaration ?? prop.declarations?.[0]
      if (!decl || !isLocalDeclaration(decl)) {
        continue
      }

      const propType = checker.getTypeOfSymbolAtLocation(prop, decl)
      const propPath = `${currentPath}.${prop.getName()}`
      const callSignatures = propType.getCallSignatures()
      if (callSignatures.length > 0) {
        const key = `${propPath}::${callSignatures[0]?.minArgumentCount ?? 0}`
        if (!seen.has(key)) {
          seen.add(key)
          results.push({
            path: propPath,
            signature: getTypeText(propType, decl),
            minArgs: callSignatures[0]?.minArgumentCount ?? 0,
            docs: getDocumentation(prop),
            deprecated: getDeprecatedNotice(prop),
          })
        }
      }

      const nestedProps = checker
        .getPropertiesOfType(propType)
        .filter(nested => {
          const nestedDecl = nested.valueDeclaration ?? nested.declarations?.[0]
          return isLocalDeclaration(nestedDecl)
        })

      if (recursive && nestedProps.length > 0) {
        walkType(propType, propPath)
      }
    }
  }

  walkType(ifaceType, prefix)
  return results
}

function dedupeEntries(entries) {
  const seen = new Set()
  const deduped = []
  for (const entry of entries) {
    const key = `${entry.path}::${entry.signature}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }
  return deduped
}

function collectClassMethods(sourceFilePath, className, prefix) {
  const source = getSource(sourceFilePath)
  const klass = findClass(source, className)
  if (!klass) {
    throw new Error(`Class not found: ${className} in ${sourceFilePath}`)
  }

  const results = []
  const members = klass.members.filter(member =>
    ts.isMethodDeclaration(member) &&
    !member.modifiers?.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword),
  )

  for (const member of members) {
    const name = member.name && ts.isIdentifier(member.name) ? member.name.text : undefined
    if (!name) continue
    const symbol = checker.getSymbolAtLocation(member.name)
    if (!symbol) continue

    const memberType = checker.getTypeOfSymbolAtLocation(symbol, member)
    const callSignature = memberType.getCallSignatures()[0]
    results.push({
      path: `${prefix}.${name}`,
      signature: getTypeText(memberType, member),
      minArgs: callSignature?.minArgumentCount ?? 0,
      docs: getDocumentation(symbol),
      deprecated: getDeprecatedNotice(symbol),
    })
  }

  const constructorMethods = klass.members.filter(member => ts.isConstructorDeclaration(member))
  if (constructorMethods.length > 0) {
    const ctor = constructorMethods[0]
    const signature = checker.getSignatureFromDeclaration(ctor)
    results.push({
      path: `${prefix}.constructor`,
      signature: signature ? checker.signatureToString(signature, ctor, ts.TypeFormatFlags.NoTruncation) : 'constructor()',
      minArgs: signature?.minArgumentCount ?? 0,
      docs: '',
      deprecated: '',
    })
  }

  return results
}

function collectExportedFunctionsFromEntry(sourceFilePath, prefix) {
  const source = getSource(sourceFilePath)
  const moduleSymbol = checker.getSymbolAtLocation(source)
  if (!moduleSymbol) {
    throw new Error(`Module symbol not found: ${sourceFilePath}`)
  }

  const exports = checker.getExportsOfModule(moduleSymbol)
  const results = []

  for (const exported of exports) {
    const targetSymbol =
      (exported.getFlags() & ts.SymbolFlags.Alias) !== 0
        ? checker.getAliasedSymbol(exported)
        : exported

    const declarations = targetSymbol.getDeclarations() ?? []
    const localDecl = declarations.find(isLocalDeclaration)
    if (!localDecl) continue

    const flags = targetSymbol.getFlags()
    const isFunctionLike = (flags & ts.SymbolFlags.Function) !== 0
    const isVariable = (flags & ts.SymbolFlags.Variable) !== 0
    const isClass = (flags & ts.SymbolFlags.Class) !== 0

    if (!isFunctionLike && !isVariable && !isClass) {
      continue
    }

    if (isClass) {
      continue
    }

    const type = checker.getTypeOfSymbolAtLocation(targetSymbol, localDecl)
    const callSig = type.getCallSignatures()[0]
    if (!callSig) {
      continue
    }

    results.push({
      path: `${prefix}.${exported.getName()}`,
      signature: getTypeText(type, localDecl),
      minArgs: callSig.minArgumentCount,
      docs: getDocumentation(targetSymbol),
      deprecated: getDeprecatedNotice(targetSymbol),
    })
  }

  return results
}

function exampleForPath(pathName, minArgs) {
  if (pathName.startsWith('athena.auth.')) {
    if (pathName.endsWith('.getUser')) {
      return `await ${pathName}()`
    }
    if (pathName.endsWith('.token')) {
      return `await ${pathName}({ token: \"token\" })`
    }
    const noArgHints = ['getSession', '.list', '.health', '.ok', '.error', '.listUserPasskeys', '.generateRegisterOptions', '.generateAuthenticateOptions', '.sendOtp']
    if (minArgs === 0 || noArgHints.some(hint => pathName.includes(hint))) {
      return `await ${pathName}()`
    }
    return `await ${pathName}({ /* input */ })`
  }

  if (pathName.startsWith('AthenaClient.builder.')) {
    const method = pathName.split('.').at(-1)
    if (method === 'build') {
      return 'const client = AthenaClient.builder().url("https://...").key("...").build()'
    }
    return `AthenaClient.builder().${method}(/* ... */)`
  }

  if (pathName.startsWith('athena.from.')) {
    const method = pathName.split('.').at(-1)
    if (method === 'findMany') {
      return 'await athena.from("orchestral_sections").findMany({ select: { name: true, instruments: { select: { name: true } } } })'
    }
    if (method === 'select') return 'await athena.from("users").select("id,name")'
    if (method === 'insert') return 'await athena.from("users").insert({ name: "Ada" }).select()'
    if (method === 'upsert') return 'await athena.from("users").upsert({ id: "u_1", name: "Ada" }).select()'
    if (method === 'update') return 'await athena.from("users").eq("id", "u_1").update({ name: "Ada" }).select()'
    if (method === 'delete') return 'await athena.from("users").eq("id", "u_1").delete()'
    if (method === 'single' || method === 'maybeSingle') return `await athena.from("users").eq("id", "u_1").${method}()`
    if (method === 'reset') return 'athena.from("users").eq("id", "u_1").reset()'
    if (['eq', 'eqCast', 'eqUuid', 'gt', 'gte', 'lt', 'lte', 'neq', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'match', 'not', 'or'].includes(method)) {
      return `athena.from("users").${method}(/* ... */)`
    }
    if (['range', 'limit', 'offset', 'currentPage', 'pageSize', 'totalPages', 'order'].includes(method)) {
      return `athena.from("users").select("id").${method}(/* ... */)`
    }
    return `athena.from("users").${method}(/* ... */)`
  }

  if (pathName.startsWith('athena.rpc.')) {
    const method = pathName.split('.').at(-1)
    if (method === 'select') return 'await athena.rpc("list_users").select()'
    if (method === 'single' || method === 'maybeSingle') return `await athena.rpc("list_users").${method}()`
    return `athena.rpc("list_users").${method}(/* ... */)`
  }

  if (pathName.startsWith('athena.db.')) {
    const method = pathName.split('.').at(-1)
    if (method === 'from') return 'athena.db.from("users").select()'
    if (method === 'select') return 'await athena.db.select("users", "id,name")'
    if (method === 'insert') return 'await athena.db.insert("users", { name: "Ada" }).select()'
    if (method === 'upsert') return 'await athena.db.upsert("users", { id: "u_1", name: "Ada" }).select()'
    if (method === 'update') return 'await athena.db.update("users", { name: "Ada" }).eq("id", "u_1").select()'
    if (method === 'delete') return 'await athena.db.delete("users", { resourceId: "u_1" }).select()'
    if (method === 'rpc') return 'await athena.db.rpc("list_users").select()'
    if (method === 'query') return 'await athena.db.query("select * from users")'
    return `athena.db.${method}(/* ... */)`
  }

  if (pathName.startsWith('athena.storage.')) {
    const method = pathName.split('.').at(-1)
    if (pathName === 'athena.storage.listStorageCatalogs') return 'await athena.storage.listStorageCatalogs()'
    if (pathName === 'athena.storage.listStorageCredentials') return 'await athena.storage.listStorageCredentials()'
    if (pathName === 'athena.storage.getStorageFile') return 'await athena.storage.getStorageFile("file_1")'
    if (pathName === 'athena.storage.getStorageFileUrl') {
      return 'await athena.storage.getStorageFileUrl("file_1", { purpose: "download" })'
    }
    if (pathName === 'athena.storage.getStorageFileProxy') {
      return 'await athena.storage.getStorageFileProxy("file_1", { purpose: "stream" })'
    }
    if (pathName === 'athena.storage.file.upload') {
      return 'await athena.storage.file.upload({ s3_id: "s3_1", files: selectedFile })'
    }
    if (pathName === 'athena.storage.file.download') {
      return 'await athena.storage.file.download("file_1", { purpose: "download" })'
    }
    if (pathName === 'athena.storage.file.get') return 'await athena.storage.file.get("file_1")'
    if (pathName === 'athena.storage.file.update') {
      return 'await athena.storage.file.update("file_1", { storage_key: "reports/archive.pdf" })'
    }
    if (pathName === 'athena.storage.file.copy') {
      return 'await athena.storage.file.copy("file_1", { storage_key: "reports/report-copy.pdf" })'
    }
    if (pathName === 'athena.storage.file.visibility.update') {
      return 'await athena.storage.file.visibility.update("file_1", { public: true })'
    }
    if (pathName === 'athena.storage.file.visibility.set') {
      return 'await athena.storage.file.visibility.set("file_1", { visibility: "public" })'
    }
    if (pathName === 'athena.storage.file.visibility.setMany') {
      return 'await athena.storage.file.visibility.setMany({ file_ids: ["file_1"], public: true })'
    }
    if (pathName === 'athena.storage.object.exists') {
      return 'await athena.storage.object.exists({ endpoint: "https://s3.example.com", region: "us-east-1", access_key_id: "AKIA...", secret_key: "secret", bucket: "documents", key: "reports/report.pdf" })'
    }
    if (pathName === 'athena.storage.bucket.cors.get') {
      return 'await athena.storage.bucket.cors.get({ endpoint: "https://s3.example.com", region: "us-east-1", access_key_id: "AKIA...", secret_key: "secret", bucket: "documents" })'
    }
    if (pathName === 'athena.storage.multipart.create') {
      return 'await athena.storage.multipart.create({ file_id: "file_1", content_type: "application/pdf" })'
    }
    if (pathName === 'athena.storage.audit.list') {
      return 'await athena.storage.audit.list({ file_id: "file_1" })'
    }
    return `await ${pathName}(/* ... */)`
  }

  if (pathName.startsWith('AthenaQueryClient.')) {
    const method = pathName.split('.').at(-1)
    if (method === 'constructor') return 'const queryClient = new AthenaQueryClient({ cache: { mode: "memory" } })'
    return `queryClient.${method}(/* ... */)`
  }

  if (pathName.startsWith('cookies.')) {
    const method = pathName.split('.').at(-1)
    return minArgs === 0 ? `${pathName}()` : `${pathName}(${method.includes('Cookie') ? '/* cookie inputs */' : '/* ... */'})`
  }

  if (pathName.startsWith('react.')) {
    const method = pathName.split('.').at(-1)
    if (method === 'useQuery') return 'const query = useQuery({ queryKey: ["users"], queryFn: () => athena.from("users").select() })'
    if (method === 'useMutation') return 'const mutation = useMutation({ mutationFn: (v) => athena.from("users").insert(v).select() })'
    if (method === 'useSession') return 'const session = useSession(athena)'
    if (method === 'useAthenaSessionClient') {
      return 'const sessionClient = useAthenaSessionClient(athena)'
    }
    return `${pathName}(/* ... */)`
  }

  if (pathName.startsWith('next.client.')) {
    const method = pathName.split('.').at(-1)
    if (method === 'createAthenaBrowserClient') {
      return 'const athena = createAthenaBrowserClient()'
    }
    return `${pathName}(/* ... */)`
  }

  if (pathName.startsWith('next.server.')) {
    const method = pathName.split('.').at(-1)
    if (method === 'createAthenaServerClient') {
      return 'const athena = await createAthenaServerClient()'
    }
    if (method === 'resolveAthenaServerContext') {
      return 'const context = await resolveAthenaServerContext()'
    }
    return `${pathName}(/* ... */)`
  }

  if (pathName.startsWith('utils.')) {
    return minArgs === 0 ? `${pathName}()` : `${pathName}(/* ... */)`
  }

  if (pathName.startsWith('root.')) {
    if (pathName === 'root.AthenaClient.builder') {
      return 'const athena = AthenaClient.builder().url(\"https://...\").key(\"api_key\").build()'
    }
    if (pathName === 'root.AthenaClient.fromEnvironment') {
      return 'const athena = AthenaClient.fromEnvironment()'
    }
    const method = pathName.split('.').at(-1)
    if (method === 'createClient') return 'const athena = createClient("https://...", "api_key")'
    if (method === 'createTypedClient') return 'const typed = createTypedClient(registry, "https://...", "api_key")'
    if (method === 'runSchemaGenerator') return 'await runSchemaGenerator({ configPath: "./athena.config.ts" })'
    if (method === 'defineModel') return 'const model = defineModel<{ id: string }>({ meta: { primaryKey: ["id"], nullable: { id: false } } })'
    if (method === 'defineSchema') return 'const schema = defineSchema({ users: defineModel<{ id: string }>({ meta: { primaryKey: ["id"], nullable: { id: false } } }) })'
    if (method === 'defineDatabase') return 'const db = defineDatabase({ public: defineSchema({}) })'
    if (method === 'defineRegistry') return 'const registry = defineRegistry({ primary: defineDatabase({ public: defineSchema({}) }) })'
    if (method === 'createModelFormAdapter') return 'const adapter = createModelFormAdapter(model)'
    if (method === 'toModelFormDefaults') return 'const defaults = toModelFormDefaults(model, row)'
    if (method === 'toModelPayload') return 'const payload = toModelPayload(model, values)'
    if (method === 'AthenaClient') return 'const athena = AthenaClient.builder().url("https://...").key("...").build()'
    return minArgs === 0 ? `${method}()` : `${method}(/* ... */)`
  }

  return minArgs === 0 ? `${pathName}()` : `${pathName}(/* ... */)`
}

function toMarkdownTable(entries) {
  const header = '| Method | Signature | Example | Notes |\n|---|---|---|---|'
  const rows = entries
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(entry => {
      const signature = sanitizeSignature(entry.signature)
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ')
      const docs = [entry.docs, entry.deprecated ? `Deprecated: ${entry.deprecated}` : '']
        .filter(Boolean)
        .join(' ')
        .replace(/\|/g, '\\|')
      const example = exampleForPath(entry.path, entry.minArgs).replace(/\|/g, '\\|')
      return `| \`${entry.path}\` | \`${signature}\` | \`${example}\` | ${docs || '—'} |`
    })
  return [header, ...rows].join('\n')
}

const runtimeBuilder = collectInterfaceMethods('src/client.ts', 'AthenaClientBuilder', 'AthenaClient.builder', { recursive: false })
const runtimeClient = collectInterfaceMethods('src/client.ts', 'AthenaSdkClient', 'athena', { recursive: false })
const runtimeTableBuilder = collectInterfaceMethods('src/client.ts', 'TableQueryBuilder', 'athena.from', { recursive: false })
const runtimeSelectChain = collectInterfaceMethods('src/client.ts', 'SelectChain', 'athena.from.select', { recursive: false })
const runtimeUpdateChain = collectInterfaceMethods('src/client.ts', 'UpdateChain', 'athena.from.update', { recursive: false })
const runtimeRpcBuilder = collectInterfaceMethods('src/client.ts', 'RpcQueryBuilder', 'athena.rpc', { recursive: false })
const runtimeDb = collectInterfaceMethods('src/db/module.ts', 'AthenaDbModule', 'athena.db', { recursive: false })
const runtimeStorage = collectInterfaceMethods('src/storage/module.ts', 'AthenaStorageModule', 'athena.storage')

const authBindings = collectInterfaceMethods('src/auth/types.ts', 'AthenaAuthBindings', 'athena.auth', { recursive: true })

const reactQueryClientClass = collectClassMethods('src/react/query-client.ts', 'AthenaQueryClient', 'AthenaQueryClient')
const reactExports = [
  ...collectExportedFunctionsFromEntry('src/react/index.ts', 'react'),
  ...collectExportedFunctionsFromEntry('src/react/provider.ts', 'react'),
  ...collectExportedFunctionsFromEntry('src/react/use-query.ts', 'react'),
  ...collectExportedFunctionsFromEntry('src/react/use-mutation.ts', 'react'),
  ...collectExportedFunctionsFromEntry('src/react/use-session.ts', 'react'),
  ...collectExportedFunctionsFromEntry('src/react/use-athena-session-client.ts', 'react'),
]

const nextClientExports = collectExportedFunctionsFromEntry('src/next/client.ts', 'next.client')
const nextServerExports = collectExportedFunctionsFromEntry('src/next/server.ts', 'next.server')

const cookieExports = collectExportedFunctionsFromEntry('src/cookies/index.ts', 'cookies')
const utilsExports = collectExportedFunctionsFromEntry('src/utils/index.ts', 'utils')

const rootExports = collectExportedFunctionsFromEntry('src/index.ts', 'root')
const clientClass = collectClassMethods('src/client.ts', 'AthenaClient', 'root.AthenaClient')

const sections = [
  {
    title: 'Root Exported Functions and Classes (`@xylex-group/athena`)',
    entries: dedupeEntries([...rootExports, ...clientClass]),
  },
  {
    title: 'Runtime Client Fluent Builder and Query Methods',
    entries: dedupeEntries([
      ...runtimeBuilder,
      ...runtimeClient,
      ...runtimeDb,
      ...runtimeStorage,
      ...runtimeTableBuilder,
      ...runtimeSelectChain,
      ...runtimeUpdateChain,
      ...runtimeRpcBuilder,
    ]),
  },
  {
    title: 'Auth Bindings (`createClient(...).auth`) - Exhaustive',
    entries: dedupeEntries(authBindings),
  },
  {
    title: 'React Runtime Methods (`@xylex-group/athena/react`)',
    entries: dedupeEntries([...reactExports, ...reactQueryClientClass]),
  },
  {
    title: 'Next.js Helpers (`@xylex-group/athena/next/*`)',
    entries: dedupeEntries([...nextClientExports, ...nextServerExports]),
  },
  {
    title: 'Cookie Methods (`@xylex-group/athena/cookies`)',
    entries: dedupeEntries(cookieExports),
  },
  {
    title: 'Utilities (`@xylex-group/athena/utils`)',
    entries: dedupeEntries(utilsExports),
  },
]

const totalMethods = sections.reduce((sum, section) => sum + section.entries.length, 0)

let markdown = ''
markdown += '# Complete SDK Method Reference\n\n'
markdown += 'This file is generated from the TypeScript source and is intended to document every public SDK method surface with a usage example.\n\n'
markdown += `Total documented method paths: **${totalMethods}**\n\n`
markdown += 'Regenerate with: `node scripts/generate-sdk-method-reference.mjs`\n\n'

for (const section of sections) {
  markdown += `## ${section.title}\n\n`
  markdown += toMarkdownTable(section.entries)
  markdown += '\n\n'
}

const outputPath = path.join(cwd, 'docs', 'complete-method-reference.md')
fs.writeFileSync(outputPath, markdown, 'utf8')

console.log(`Generated ${outputPath}`)
console.log(`Documented ${totalMethods} method paths`)
for (const section of sections) {
  console.log(`- ${section.title}: ${section.entries.length}`)
}
