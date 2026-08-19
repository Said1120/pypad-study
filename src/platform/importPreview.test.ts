import { expect, test } from 'vitest'
import { createStarterWorkspace } from '../domain/workspace'
import { buildImportPreview } from './importPreview'

test('previews project contents and warns about a same-name project', () => {
  const workspace = createStarterWorkspace('循环练习', 100, () => crypto.randomUUID())

  expect(buildImportPreview(workspace, ['循环练习', '函数练习'])).toContain('1 个文件')
  expect(buildImportPreview(workspace, ['循环练习', '函数练习'])).toContain('已有同名项目')
})
