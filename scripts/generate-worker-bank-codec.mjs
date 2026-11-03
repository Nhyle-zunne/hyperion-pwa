import ts from 'typescript'
import { readFile, writeFile } from 'node:fs/promises'
const text = await readFile('supabase/functions/question-bank/index.ts', 'utf8')
const ast = ts.createSourceFile('bank.ts', text, ts.ScriptTarget.Latest, true)
const declarations = new Map()
for (const statement of ast.statements) {
  if (statement.name && ts.isIdentifier(statement.name)) declarations.set(statement.name.text, statement)
  if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, statement)
}
const roots = ['SOURCE_ASSETS', 'decryptToText', 'sampleFreeCsv', 'toSearchQuestions', 'trackForPath', 'sourceInfo', 'deriveKeyBytes', 'validQuestionCount']
const names = new Set(roots)
for (const name of names) {
  const statement = declarations.get(name)
  if (!statement) throw new Error(`Missing bank codec declaration: ${name}`)
  const visit = node => { if (ts.isIdentifier(node) && declarations.has(node.text)) names.add(node.text); ts.forEachChild(node, visit) }
  visit(statement)
}
const selected = new Set([...names].map(name => declarations.get(name)))
const code = '// Generated from the existing server parser. Regenerate with scripts/generate-worker-bank-codec.mjs.\n' + ast.statements.filter(statement => selected.has(statement)).map(statement => statement.getText(ast)).join('\n') + `\nexport { ${roots.join(', ')} };\n`
if (code.includes('Deno.') || code.includes('SUPABASE_SERVICE_ROLE_KEY')) throw new Error('The bank codec must not depend on server credentials.')
const path = 'supabase/functions/_shared/bankCodec.ts'
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== code) throw new Error('Worker and Supabase question parsers differ; regenerate the Worker codec.')
} else await writeFile(path, code)
console.log('Worker bank codec matches the existing question parser.')
