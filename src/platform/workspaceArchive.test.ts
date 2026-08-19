import { expect, test } from 'vitest'
import { addFile, addFolder, createStarterWorkspace } from '../domain/workspace'
import { exportWorkspaceZip, importWorkspaceZip } from './workspaceArchive'

test('ZIP export and import preserves nested text files', async () => {
  let workspace = createStarterWorkspace('归档练习', 100, () => crypto.randomUUID())
  const folderId = 'folder'
  workspace = addFolder(workspace, null, '示例', 101, () => folderId)
  workspace = addFile(workspace, folderId, 'hello.py', 'print("zip")\n', 102, () => 'hello')

  const zip = exportWorkspaceZip(workspace)
  const imported = importWorkspaceZip(zip, 200, () => crypto.randomUUID())

  expect(imported.project.name).toBe('归档练习')
  expect(imported.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'folder', name: '示例', parentId: null }),
    expect.objectContaining({ kind: 'file', name: 'hello.py', content: 'print("zip")\n' }),
  ]))
  const folder = imported.nodes.find((node) => node.name === '示例')
  const file = imported.nodes.find((node) => node.name === 'hello.py')
  expect(file?.parentId).toBe(folder?.id)
})

