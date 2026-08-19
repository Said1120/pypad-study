export type NodeKind = 'file' | 'folder'

export interface Project {
  id: string
  name: string
  entryFileId: string
  createdAt: number
  updatedAt: number
}

export interface FileNode {
  id: string
  projectId: string
  parentId: string | null
  kind: NodeKind
  name: string
  content: string
  updatedAt: number
}

export interface Workspace {
  project: Project
  nodes: FileNode[]
}

export type IdGenerator = () => string

const defaultId: IdGenerator = () => crypto.randomUUID()

function validateName(name: string): string {
  const clean = name.trim()
  if (!clean) throw new Error('名称不能为空')
  if (clean.includes('/') || clean.includes('\\')) throw new Error('名称不能包含路径分隔符')
  return clean
}

function assertUnique(workspace: Workspace, parentId: string | null, name: string, exceptId?: string): void {
  const exists = workspace.nodes.some((node) => node.parentId === parentId && node.name === name && node.id !== exceptId)
  if (exists) throw new Error('同一文件夹中已存在同名项目')
}

function assertFolder(workspace: Workspace, parentId: string | null): void {
  if (parentId === null) return
  if (!workspace.nodes.some((node) => node.id === parentId && node.kind === 'folder')) {
    throw new Error('目标文件夹不存在')
  }
}

export function createStarterWorkspace(
  name = '我的 Python 项目',
  now = Date.now(),
  nextId: IdGenerator = defaultId,
): Workspace {
  const projectId = nextId()
  const fileId = nextId()
  return {
    project: {
      id: projectId,
      name: validateName(name),
      entryFileId: fileId,
      createdAt: now,
      updatedAt: now,
    },
    nodes: [{
      id: fileId,
      projectId,
      parentId: null,
      kind: 'file',
      name: 'main.py',
      content: 'print("你好，PyPad！")\n',
      updatedAt: now,
    }],
  }
}

export function addFile(
  workspace: Workspace,
  parentId: string | null,
  name: string,
  content = '',
  now = Date.now(),
  nextId: IdGenerator = defaultId,
): Workspace {
  const clean = validateName(name)
  assertFolder(workspace, parentId)
  assertUnique(workspace, parentId, clean)
  return {
    project: { ...workspace.project, updatedAt: now },
    nodes: [...workspace.nodes, {
      id: nextId(),
      projectId: workspace.project.id,
      parentId,
      kind: 'file',
      name: clean,
      content,
      updatedAt: now,
    }],
  }
}

export function addFolder(
  workspace: Workspace,
  parentId: string | null,
  name: string,
  now = Date.now(),
  nextId: IdGenerator = defaultId,
): Workspace {
  const clean = validateName(name)
  assertFolder(workspace, parentId)
  assertUnique(workspace, parentId, clean)
  return {
    project: { ...workspace.project, updatedAt: now },
    nodes: [...workspace.nodes, {
      id: nextId(),
      projectId: workspace.project.id,
      parentId,
      kind: 'folder',
      name: clean,
      content: '',
      updatedAt: now,
    }],
  }
}

export function updateFileContent(workspace: Workspace, nodeId: string, content: string, now = Date.now()): Workspace {
  const target = workspace.nodes.find((node) => node.id === nodeId && node.kind === 'file')
  if (!target) throw new Error('文件不存在')
  return {
    project: { ...workspace.project, updatedAt: now },
    nodes: workspace.nodes.map((node) => node.id === nodeId ? { ...node, content, updatedAt: now } : node),
  }
}

export function renameNode(workspace: Workspace, nodeId: string, name: string, now = Date.now()): Workspace {
  const target = workspace.nodes.find((node) => node.id === nodeId)
  if (!target) throw new Error('文件或文件夹不存在')
  const clean = validateName(name)
  assertUnique(workspace, target.parentId, clean, nodeId)
  return {
    project: { ...workspace.project, updatedAt: now },
    nodes: workspace.nodes.map((node) => node.id === nodeId ? { ...node, name: clean, updatedAt: now } : node),
  }
}

export function duplicateNode(
  workspace: Workspace,
  nodeId: string,
  now = Date.now(),
  nextId: IdGenerator = defaultId,
): Workspace {
  const target = workspace.nodes.find((node) => node.id === nodeId)
  if (!target) throw new Error('文件或文件夹不存在')
  let copyName = `${target.name} 副本`
  let suffix = 2
  while (workspace.nodes.some((node) => node.parentId === target.parentId && node.name === copyName)) {
    copyName = `${target.name} 副本 ${suffix++}`
  }

  const copies: FileNode[] = []
  const copyRecursively = (source: FileNode, parentId: string | null, name: string): void => {
    const copyId = nextId()
    copies.push({ ...source, id: copyId, parentId, name, updatedAt: now })
    workspace.nodes
      .filter((node) => node.parentId === source.id)
      .forEach((child) => copyRecursively(child, copyId, child.name))
  }
  copyRecursively(target, target.parentId, copyName)
  return {
    project: { ...workspace.project, updatedAt: now },
    nodes: [...workspace.nodes, ...copies],
  }
}

export function removeNode(
  workspace: Workspace,
  nodeId: string,
  now = Date.now(),
  nextId: IdGenerator = defaultId,
): Workspace {
  if (!workspace.nodes.some((node) => node.id === nodeId)) throw new Error('文件或文件夹不存在')
  const removedIds = new Set<string>([nodeId])
  let changed = true
  while (changed) {
    changed = false
    for (const node of workspace.nodes) {
      if (node.parentId && removedIds.has(node.parentId) && !removedIds.has(node.id)) {
        removedIds.add(node.id)
        changed = true
      }
    }
  }
  let nodes = workspace.nodes.filter((node) => !removedIds.has(node.id))
  let entryFileId = workspace.project.entryFileId
  if (removedIds.has(entryFileId)) {
    const replacement = nodes.find((node) => node.kind === 'file' && node.name.endsWith('.py'))
    if (replacement) {
      entryFileId = replacement.id
    } else {
      entryFileId = nextId()
      nodes = [...nodes, {
        id: entryFileId,
        projectId: workspace.project.id,
        parentId: null,
        kind: 'file',
        name: 'main.py',
        content: '',
        updatedAt: now,
      }]
    }
  }
  return {
    project: { ...workspace.project, entryFileId, updatedAt: now },
    nodes,
  }
}

export function setEntryFile(workspace: Workspace, nodeId: string, now = Date.now()): Workspace {
  const target = workspace.nodes.find((node) => node.id === nodeId && node.kind === 'file' && node.name.endsWith('.py'))
  if (!target) throw new Error('入口必须是 Python 文件')
  return { ...workspace, project: { ...workspace.project, entryFileId: nodeId, updatedAt: now } }
}

