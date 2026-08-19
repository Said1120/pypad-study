import { describe, expect, test } from 'vitest'
import { explainPythonError } from './explainPythonError'

describe('explainPythonError', () => {
  test('explains NameError with the missing variable and source line', () => {
    const result = explainPythonError("Traceback (most recent call last):\n  File \"/project/main.py\", line 3, in <module>\n    print(score)\nNameError: name 'score' is not defined")

    expect(result).toEqual({
      kind: 'NameError',
      line: 3,
      title: '名称尚未定义',
      explanation: 'Python 找不到名为 score 的变量、函数或模块。',
      suggestions: ['检查 score 是否拼写正确', '确认在使用 score 之前已经给它赋值'],
    })
  })

  test('returns no guessed explanation for an unknown exception', () => {
    expect(explainPythonError('MysteryError: something unusual')).toBeNull()
  })
})

