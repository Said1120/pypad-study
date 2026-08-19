import type { FileNode, Workspace } from '../domain/workspace'

export interface RuntimeFile {
  path: string
  content: string
}

export type RuntimeCommand =
  | { type: 'initialize'; indexURL: string; interruptBuffer: SharedArrayBuffer; stdinBuffer: SharedArrayBuffer }
  | { type: 'syncProject'; files: RuntimeFile[] }
  | { type: 'run'; entryPath: string }
  | { type: 'provideStdin' }
  | { type: 'interrupt' }
  | { type: 'installPackage'; packageName: SupportedPackage }
  | { type: 'reset' }

export type RuntimeStatus = 'loading' | 'ready' | 'running' | 'waiting-input' | 'stopping' | 'error'

export type RuntimeEvent =
  | { type: 'status'; status: RuntimeStatus; message: string }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'stdinRequest'; prompt: string }
  | { type: 'plot'; dataUrl: string }
  | { type: 'exception'; traceback: string }
  | { type: 'packageProgress'; packageName: SupportedPackage; status: 'downloading' | 'ready' | 'error'; message: string }
  | { type: 'finished'; durationMs: number; interrupted: boolean }

export type SupportedPackage = 'numpy' | 'matplotlib' | 'pandas'

const eventTypes = new Set(['status', 'stdout', 'stderr', 'stdinRequest', 'plot', 'exception', 'packageProgress', 'finished'])

export function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  if (typeof event.type !== 'string' || !eventTypes.has(event.type)) return false
  switch (event.type) {
    case 'status': return typeof event.status === 'string' && typeof event.message === 'string'
    case 'stdout':
    case 'stderr': return typeof event.text === 'string'
    case 'stdinRequest': return typeof event.prompt === 'string'
    case 'plot': return typeof event.dataUrl === 'string'
    case 'exception': return typeof event.traceback === 'string'
    case 'packageProgress': return typeof event.packageName === 'string' && typeof event.status === 'string' && typeof event.message === 'string'
    case 'finished': return typeof event.durationMs === 'number' && typeof event.interrupted === 'boolean'
    default: return false
  }
}

function pathForNode(nodes: FileNode[], node: FileNode): string {
  const parts = [node.name]
  let parentId = node.parentId
  const seen = new Set<string>([node.id])
  while (parentId) {
    if (seen.has(parentId)) throw new Error('项目目录存在循环引用')
    seen.add(parentId)
    const parent = nodes.find((candidate) => candidate.id === parentId && candidate.kind === 'folder')
    if (!parent) throw new Error('项目目录结构损坏')
    parts.unshift(parent.name)
    parentId = parent.parentId
  }
  const path = parts.join('/')
  if (parts.some((part) => part === '..' || part === '.')) throw new Error('文件路径不安全')
  return path
}

export function workspaceFiles(workspace: Workspace): { files: RuntimeFile[]; entryPath: string } {
  const files = workspace.nodes
    .filter((node) => node.kind === 'file')
    .map((node) => ({ path: pathForNode(workspace.nodes, node), content: node.content }))
  const entry = workspace.nodes.find((node) => node.id === workspace.project.entryFileId && node.kind === 'file')
  if (!entry) throw new Error('入口文件不存在')
  return { files, entryPath: pathForNode(workspace.nodes, entry) }
}

