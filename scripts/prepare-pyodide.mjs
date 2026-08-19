import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', 'pyodide')
const destination = join(root, 'public', 'pyodide')
const packageJson = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(join(source, 'pyodide-lock.json'), 'utf8'))
const baseUrl = `https://cdn.jsdelivr.net/pyodide/v${packageJson.version}/full/`

await mkdir(destination, { recursive: true })

for (const file of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  await copyFile(join(source, file), join(destination, file))
}

const selected = new Set()
const include = (name) => {
  if (selected.has(name)) return
  const item = lock.packages[name]
  if (!item) throw new Error(`Pyodide lock file has no package named ${name}`)
  selected.add(name)
  item.depends.forEach(include)
}
;['numpy', 'matplotlib', 'pandas'].forEach(include)

for (const name of [...selected].sort()) {
  const fileName = lock.packages[name].file_name
  const target = join(destination, fileName)
  try {
    if ((await stat(target)).size > 0) continue
  } catch {
    // Download below.
  }
  const response = await fetch(new URL(fileName, baseUrl))
  if (!response.ok) throw new Error(`Unable to download ${fileName}: ${response.status}`)
  await writeFile(target, new Uint8Array(await response.arrayBuffer()))
}

console.log(`Prepared Pyodide ${packageJson.version} with ${selected.size} offline package assets.`)

