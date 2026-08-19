import { expect, test } from 'vitest'
import { explainPackageError } from './explainPackageError'

test('distinguishes offline, storage, version, and WebAssembly package failures', () => {
  expect(explainPackageError('Failed to fetch', false)).toContain('未联网')
  expect(explainPackageError('QuotaExceededError', true)).toContain('缓存空间不足')
  expect(explainPackageError('dependency version conflict', true)).toContain('版本冲突')
  expect(explainPackageError('WebAssembly platform unsupported', true)).toContain('WebAssembly 不兼容')
})
