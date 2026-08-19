import { useState } from 'react'
import type { FileNode, Workspace } from '../domain/workspace'

interface FileTreeProps {
  workspace: Workspace
  activeFileId: string
  activeFolderId: string | null
  onOpen(id: string): void
  onSelectFolder(id: string): void
  onContext(node: FileNode): void
}

export function FileTree({ workspace, activeFileId, activeFolderId, onOpen, onSelectFolder, onContext }: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const openNode = (node: FileNode) => {
    if (node.kind === 'file') {
      onOpen(node.id)
      return
    }
    if (activeFolderId === node.id) {
      setCollapsed((current) => {
        const next = new Set(current)
        if (next.has(node.id)) next.delete(node.id)
        else next.add(node.id)
        return next
      })
    }
    onSelectFolder(node.id)
  }
  const renderNodes = (parentId: string | null, depth: number) => workspace.nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN') : a.kind === 'folder' ? -1 : 1)
    .map((node) => (
      <div key={node.id}>
        <div className={`tree-row ${node.id === activeFileId ? 'active' : ''} ${node.id === activeFolderId ? 'active-folder' : ''}`} style={{ paddingInlineStart: `${12 + depth * 18}px` }}>
          <button
            type="button"
            className="tree-open"
            onClick={() => openNode(node)}
            aria-current={node.id === activeFileId ? 'page' : undefined}
            aria-pressed={node.kind === 'folder' ? node.id === activeFolderId : undefined}
          >
            <span aria-hidden="true">{node.kind === 'folder' ? collapsed.has(node.id) ? '▸' : '▾' : node.name.endsWith('.py') ? '◇' : '·'}</span>
            <span className="tree-name">{node.name}</span>
            {node.id === workspace.project.entryFileId && <span className="entry-mark" title="入口文件">运行</span>}
          </button>
          <button type="button" className="icon-button tree-menu" aria-label={`${node.name} 更多操作`} onClick={() => onContext(node)}>•••</button>
        </div>
        {node.kind === 'folder' && !collapsed.has(node.id) && renderNodes(node.id, depth + 1)}
      </div>
    ))

  return <nav className="file-tree" aria-label="项目文件">{renderNodes(null, 0)}</nav>
}
