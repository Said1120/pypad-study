import { describe, expect, test } from 'vitest'
import { isRuntimeEvent, workspaceFiles } from './protocol'
import { addFile, addFolder, createStarterWorkspace } from '../domain/workspace'

describe('runtime protocol', () => {
  test('maps a nested workspace to safe POSIX paths and identifies the entry path', () => {
    let workspace = createStarterWorkspace('项目', 100, () => 'main')
    workspace = { ...workspace, project: { ...workspace.project, id: 'project', entryFileId: 'main' }, nodes: workspace.nodes.map((node) => ({ ...node, projectId: 'project' })) }
    workspace = addFolder(workspace, null, 'lib', 101, () => 'lib')
    workspace = addFile(workspace, 'lib', 'maths.py', 'value = 42\n', 102, () => 'maths')

    expect(workspaceFiles(workspace)).toEqual({
      entryPath: 'main.py',
      files: [
        { path: 'main.py', content: 'print("你好，PyPad！")\n' },
        { path: 'lib/maths.py', content: 'value = 42\n' },
      ],
    })
  })

  test('rejects malformed worker events instead of trusting untyped data', () => {
    expect(isRuntimeEvent({ type: 'stdout', text: 'ok' })).toBe(true)
    expect(isRuntimeEvent({ type: 'stdout', text: 7 })).toBe(false)
    expect(isRuntimeEvent({ type: 'unknown' })).toBe(false)
    expect(isRuntimeEvent(null)).toBe(false)
  })
})

