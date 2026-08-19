import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { ARCHIVE_MANIFEST_NAME, type FileNode, type IdGenerator, type Workspace } from '../domain/workspace'

export const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
const MAX_ARCHIVE_FILES = 500
const MAX_ARCHIVE_FILE_BYTES = 2 * 1024 * 1024
const MAX_ARCHIVE_OUTPUT_BYTES = 10 * 1024 * 1024
const MAX_ARCHIVE_PATH_LENGTH = 512

interface ArchiveManifest {
  format: 1
  name: string
  entryPath: string
}

function archiveError(message: string): Error {
  return new Error(`项目归档不安全或格式错误：${message}`)
}

function validateProjectName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 120 || /[\\/]/.test(value)) {
    throw archiveError('项目名称无效')
  }
  return value
}

function validateArchivePath(path: unknown): string {
  if (typeof path !== 'string' || !path || path.length > MAX_ARCHIVE_PATH_LENGTH || path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw archiveError('文件路径无效')
  }
  const parts = path.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part !== part.trim() || part.length > 128)) {
    throw archiveError('文件路径无效')
  }
  return path
}

function readManifest(bytes: Uint8Array): ArchiveManifest {
  if (bytes.byteLength > 64 * 1024) throw archiveError('清单文件过大')
  let parsed: unknown
  try {
    parsed = JSON.parse(strFromU8(bytes))
  } catch {
    throw archiveError('清单不是有效 JSON')
  }
  if (!parsed || typeof parsed !== 'object') throw archiveError('清单字段无效')
  const record = parsed as Record<string, unknown>
  if (record.format !== 1) throw archiveError('版本不受支持')
  const name = validateProjectName(record.name)
  const entryPath = validateArchivePath(record.entryPath)
  if (entryPath === ARCHIVE_MANIFEST_NAME) throw archiveError('入口文件无效')
  return { format: 1, name, entryPath }
}

function nodePath(nodes: FileNode[], node: FileNode): string {
  const parts = [node.name]
  let parentId = node.parentId
  const seen = new Set([node.id])
  while (parentId) {
    if (seen.has(parentId)) throw new Error('项目目录存在循环引用')
    seen.add(parentId)
    const parent = nodes.find((candidate) => candidate.id === parentId)
    if (!parent) throw new Error('项目目录结构损坏')
    parts.unshift(parent.name)
    parentId = parent.parentId
  }
  return parts.join('/')
}

export function exportWorkspaceZip(workspace: Workspace): Uint8Array {
  validateProjectName(workspace.project.name)
  if (workspace.nodes.some((node) => node.kind === 'file' && node.parentId === null && node.name === ARCHIVE_MANIFEST_NAME)) {
    throw new Error('根目录包含 PyPad 保留名称，无法导出')
  }
  const entry = workspace.nodes.find((node) => node.id === workspace.project.entryFileId)
  if (!entry || entry.kind !== 'file') throw new Error('入口文件不存在')
  const files: Record<string, Uint8Array> = {
    [ARCHIVE_MANIFEST_NAME]: strToU8(JSON.stringify({
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
  if (zip.byteLength > MAX_ARCHIVE_BYTES) throw archiveError('压缩包超过 10 MB')
  let fileCount = 0
  let outputBytes = 0
  const seenPaths = new Set<string>()
  const files = unzipSync(zip, {
    filter(info) {
      const isDirectory = info.name.endsWith('/')
      const path = validateArchivePath(isDirectory ? info.name.slice(0, -1) : info.name)
      if (seenPaths.has(path)) throw archiveError('包含重复路径')
      seenPaths.add(path)
      if (isDirectory) return false
      fileCount += 1
      outputBytes += info.originalSize
      if (fileCount > MAX_ARCHIVE_FILES) throw archiveError('文件数量超过 500 个')
      if (info.originalSize > MAX_ARCHIVE_FILE_BYTES) throw archiveError(`${path} 文件过大`)
      if (outputBytes > MAX_ARCHIVE_OUTPUT_BYTES) throw archiveError('解压后内容超过 10 MB')
      return true
    },
  })
  const manifestBytes = files[ARCHIVE_MANIFEST_NAME]
  if (!manifestBytes) throw new Error('这不是 PyPad 项目归档')
  const manifest = readManifest(manifestBytes)

  const projectId = nextId()
  const nodes: FileNode[] = []
  const folders = new Map<string, string>()
  let entryFileId = ''

  for (const [path, bytes] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (path === ARCHIVE_MANIFEST_NAME || path.endsWith('/')) continue
    validateArchivePath(path)
    const parts = path.split('/')
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
  if (!Object.prototype.hasOwnProperty.call(files, manifest.entryPath)) throw archiveError('入口文件不存在')
  if (!entryFileId) entryFileId = nodes.find((node) => node.kind === 'file' && node.name.endsWith('.py'))?.id ?? ''
  if (!entryFileId) throw new Error('归档中没有可运行的 Python 文件')
  return {
    project: { id: projectId, name: manifest.name, entryFileId, createdAt: now, updatedAt: now },
    nodes,
  }
}
