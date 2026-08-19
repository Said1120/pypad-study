import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { FileNode, IdGenerator, Workspace } from '../domain/workspace'

interface ArchiveManifest {
  format: 1
  name: string
  entryPath: string
}

function nodePath(nodes: FileNode[], node: FileNode): string {
  const parts = [node.name]
  let parentId = node.parentId
  while (parentId) {
    const parent = nodes.find((candidate) => candidate.id === parentId)
    if (!parent) throw new Error('项目目录结构损坏')
    parts.unshift(parent.name)
    parentId = parent.parentId
  }
  return parts.join('/')
}

export function exportWorkspaceZip(workspace: Workspace): Uint8Array {
  const entry = workspace.nodes.find((node) => node.id === workspace.project.entryFileId)
  if (!entry) throw new Error('入口文件不存在')
  const files: Record<string, Uint8Array> = {
    '.pypad-project.json': strToU8(JSON.stringify({
      format: 1,
      name: workspace.project.name,
      entryPath: nodePath(workspace.nodes, entry),
    } satisfies ArchiveManifest, null, 2)),
  }
  for (const node of workspace.nodes) {
    if (node.kind === 'file') files[nodePath(workspace.nodes, node)] = strToU8(node.content)
  }
  return zipSync(files, { level: 6 })
}

export function importWorkspaceZip(zip: Uint8Array, now = Date.now(), nextId: IdGenerator = () => crypto.randomUUID()): Workspace {
  const files = unzipSync(zip)
  const manifestBytes = files['.pypad-project.json']
  if (!manifestBytes) throw new Error('这不是 PyPad 项目归档')
  const manifest = JSON.parse(strFromU8(manifestBytes)) as ArchiveManifest
  if (manifest.format !== 1 || !manifest.name || !manifest.entryPath) throw new Error('项目归档格式不受支持')

  const projectId = nextId()
  const nodes: FileNode[] = []
  const folders = new Map<string, string>()
  let entryFileId = ''

  for (const [path, bytes] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (path === '.pypad-project.json' || path.endsWith('/')) continue
    const parts = path.split('/').filter(Boolean)
    let parentId: string | null = null
    let folderPath = ''
    for (const folderName of parts.slice(0, -1)) {
      folderPath = folderPath ? `${folderPath}/${folderName}` : folderName
      let folderId = folders.get(folderPath)
      if (!folderId) {
        folderId = nextId()
        folders.set(folderPath, folderId)
        nodes.push({ id: folderId, projectId, parentId, kind: 'folder', name: folderName, content: '', updatedAt: now })
      }
      parentId = folderId
    }
    const id = nextId()
    nodes.push({ id, projectId, parentId, kind: 'file', name: parts.at(-1)!, content: strFromU8(bytes), updatedAt: now })
    if (path === manifest.entryPath) entryFileId = id
  }
  if (!entryFileId) entryFileId = nodes.find((node) => node.kind === 'file' && node.name.endsWith('.py'))?.id ?? ''
  if (!entryFileId) throw new Error('归档中没有可运行的 Python 文件')
  return {
    project: { id: projectId, name: manifest.name, entryFileId, createdAt: now, updatedAt: now },
    nodes,
  }
}

