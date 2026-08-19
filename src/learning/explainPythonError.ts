export interface ErrorExplanation {
  kind: string
  line?: number
  title: string
  explanation: string
  suggestions: string[]
}

function sourceLine(traceback: string): number | undefined {
  const matches = [...traceback.matchAll(/File "[^"]+", line (\d+)/g)]
  const value = matches.at(-1)?.[1]
  return value ? Number(value) : undefined
}

export function explainPythonError(traceback: string): ErrorExplanation | null {
  const line = sourceLine(traceback)
  const nameError = traceback.match(/NameError: name '([^']+)' is not defined/)
  if (nameError) {
    const name = nameError[1]
    return {
      kind: 'NameError',
      line,
      title: '名称尚未定义',
      explanation: `Python 找不到名为 ${name} 的变量、函数或模块。`,
      suggestions: [`检查 ${name} 是否拼写正确`, `确认在使用 ${name} 之前已经给它赋值`],
    }
  }
  if (/SyntaxError:/.test(traceback)) {
    return {
      kind: 'SyntaxError', line, title: '语法格式不正确',
      explanation: 'Python 无法按照语法规则理解这一行代码。',
      suggestions: ['检查括号、引号和冒号是否成对完整', '查看错误箭头指向的位置及其上一行'],
    }
  }
  if (/IndentationError:|TabError:/.test(traceback)) {
    return {
      kind: 'IndentationError', line, title: '缩进不一致',
      explanation: '代码块的空格层级不符合 Python 的缩进规则。',
      suggestions: ['让同一代码块中的语句保持相同缩进', '统一使用空格缩进，不要混用 Tab'],
    }
  }
  if (/TypeError:/.test(traceback)) {
    return {
      kind: 'TypeError', line, title: '数据类型不匹配',
      explanation: '当前操作不支持参与运算的某个数据类型。',
      suggestions: ['用 type(...) 查看相关变量的类型', '在运算前使用 int、float 或 str 做明确转换'],
    }
  }
  if (/ModuleNotFoundError: No module named/.test(traceback)) {
    const moduleName = traceback.match(/No module named '([^']+)'/)?.[1] ?? '该模块'
    return {
      kind: 'ModuleNotFoundError', line, title: '模块尚未安装或找不到',
      explanation: `Python 无法加载 ${moduleName}。`,
      suggestions: ['检查模块名称是否拼写正确', '在扩展包面板中下载兼容的离线包'],
    }
  }
  if (/IndexError:/.test(traceback)) {
    return {
      kind: 'IndexError', line, title: '索引超出范围',
      explanation: '访问的位置不在列表、元组或字符串的有效范围内。',
      suggestions: ['用 len(...) 检查序列长度', '确认索引从 0 开始且小于序列长度'],
    }
  }
  if (/KeyError:/.test(traceback)) {
    return {
      kind: 'KeyError', line, title: '字典中没有这个键',
      explanation: '代码访问了字典里不存在的键。',
      suggestions: ['先用 key in dictionary 检查键是否存在', '可使用 dictionary.get(key) 提供默认值'],
    }
  }
  if (/ZeroDivisionError:/.test(traceback)) {
    return {
      kind: 'ZeroDivisionError', line, title: '不能除以零',
      explanation: '除数在运行时变成了 0。',
      suggestions: ['除法前检查除数是否为 0', '确认输入数据和计算过程是否符合预期'],
    }
  }
  return null
}

