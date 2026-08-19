import { strToU8, zipSync } from 'fflate'
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

test('rejects malformed manifest fields and unsafe archive paths', () => {
  const malformed = zipSync({
    '.pypad-project.json': strToU8(JSON.stringify({ format: 1, name: { unsafe: true }, entryPath: '../main.py' })),
    '../main.py': strToU8('print(1)'),
  })

  expect(() => importWorkspaceZip(malformed)).toThrow('项目归档')
})

test('rejects a highly compressed file beyond the per-file safety limit', () => {
  const oversized = zipSync({
    '.pypad-project.json': strToU8(JSON.stringify({ format: 1, name: '过大项目', entryPath: 'main.py' })),
    'main.py': new Uint8Array(6 * 1024 * 1024),
  }, { level: 9 })

  expect(() => importWorkspaceZip(oversized)).toThrow('文件过大')
})
