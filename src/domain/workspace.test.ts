import { describe, expect, test } from 'vitest'
import {
  addFile,
  addFolder,
  createStarterWorkspace,
  duplicateNode,
  moveNode,
  removeNode,
  renameNode,
} from './workspace'

const ids = (...values: string[]) => {
  let index = 0
  return () => values[index++] ?? `generated-${index}`
}

describe('workspace model', () => {
  test('creates a starter project with main.py as the entry file', () => {
    const workspace = createStarterWorkspace('我的练习', 100, ids('project-1', 'file-1'))

    expect(workspace.project).toEqual({
      id: 'project-1',
      name: '我的练习',
      entryFileId: 'file-1',
      createdAt: 100,
      updatedAt: 100,
    })
    expect(workspace.nodes).toEqual([
      {
        id: 'file-1',
        projectId: 'project-1',
        parentId: null,
        kind: 'file',
        name: 'main.py',
        content: 'print("你好，PyPad！")\n',
        updatedAt: 100,
      },
    ])
  })

  test('rejects duplicate names in the same folder but permits them in different folders', () => {
    let workspace = createStarterWorkspace('项目', 100, ids('p', 'main'))
    workspace = addFolder(workspace, null, '练习', 101, ids('folder-a'))
    workspace = addFolder(workspace, null, '答案', 102, ids('folder-b'))
    workspace = addFile(workspace, 'folder-a', 'hello.py', '', 103, ids('file-a'))
    workspace = addFile(workspace, 'folder-b', 'hello.py', '', 104, ids('file-b'))

    expect(() => addFile(workspace, 'folder-a', 'hello.py', '', 105, ids('file-c'))).toThrow('同一文件夹中已存在同名项目')
  })

  test('duplicates a folder and all descendants with fresh ids', () => {
    let workspace = createStarterWorkspace('项目', 100, ids('p', 'main'))
    workspace = addFolder(workspace, null, '章节', 101, ids('folder'))
    workspace = addFile(workspace, 'folder', 'demo.py', 'x = 1\n', 102, ids('demo'))
    workspace = duplicateNode(workspace, 'folder', 103, ids('folder-copy', 'demo-copy'))

    expect(workspace.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'folder-copy', parentId: null, name: '章节 副本' }),
      expect.objectContaining({ id: 'demo-copy', parentId: 'folder-copy', name: 'demo.py', content: 'x = 1\n' }),
    ]))
  })

  test('keeps a runnable entry file when deleting the current entry', () => {
    let workspace = createStarterWorkspace('项目', 100, ids('p', 'main'))
    workspace = addFile(workspace, null, 'second.py', 'print(2)\n', 101, ids('second'))
    workspace = renameNode(workspace, 'second', 'lesson.py', 102)
    workspace = removeNode(workspace, 'main', 103)

    expect(workspace.project.entryFileId).toBe('second')
    expect(workspace.nodes.some((node) => node.id === 'main')).toBe(false)
  })

  test('reserves the root archive manifest name for ZIP backups', () => {
    const workspace = createStarterWorkspace('练习', 100, ids('project', 'main'))

    expect(() => addFile(workspace, null, '.pypad-project.json')).toThrow('名称由 PyPad 保留')
    expect(() => renameNode(workspace, 'main', '.pypad-project.json')).toThrow('名称由 PyPad 保留')
  })

  test('moves files into folders and prevents moving a folder into its descendant', () => {
    let workspace = createStarterWorkspace('练习', 100, ids('project', 'main'))
    workspace = addFolder(workspace, null, '章节', 101, ids('chapter'))
    workspace = addFolder(workspace, 'chapter', '子目录', 102, ids('child'))

    expect(moveNode(workspace, 'main', 'chapter').nodes.find((node) => node.id === 'main')?.parentId).toBe('chapter')
    expect(() => moveNode(workspace, 'chapter', 'child')).toThrow('不能移动到自身的子文件夹')
  })

  test('uses the same safe name limits as ZIP import', () => {
    expect(() => createStarterWorkspace('项'.repeat(121), 100, ids('project', 'main'))).toThrow('项目名称不能超过 120 个字符')
    const workspace = createStarterWorkspace('练习', 100, ids('project', 'main'))
    expect(() => addFile(workspace, null, '..')).toThrow('名称不能是 . 或 ..')
    expect(() => addFolder(workspace, null, 'a'.repeat(129))).toThrow('名称不能超过 128 个字符')
  })
})
