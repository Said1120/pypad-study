import { FormEvent, useState } from 'react'
import type { ErrorExplanation } from '../learning/explainPythonError'
import type { RuntimeStatus, SupportedPackage } from '../runtime/protocol'

export type OutputItem =
  | { id: string; kind: 'stdout' | 'stderr'; text: string }
  | { id: string; kind: 'plot'; dataUrl: string }
  | { id: string; kind: 'exception'; text: string; explanation: ErrorExplanation | null }

interface OutputPanelProps {
  items: OutputItem[]
  status: RuntimeStatus
  statusMessage: string
  waitingForInput: boolean
  onSubmitInput(value: string): void
  onClear(): void
  onInstallPackage(name: SupportedPackage): void
  packageMessages: Partial<Record<SupportedPackage, string>>
}

const cheatSheet = [
  ['输出', 'print("你好")'],
  ['输入', 'name = input("名字：")'],
  ['循环', 'for item in items:'],
  ['函数', 'def greet(name):'],
  ['列表', 'numbers = [1, 2, 3]'],
  ['字典', 'person = {"name": "小明"}'],
]

const packageDetails: Record<SupportedPackage, string> = {
  numpy: '数组与数值计算 · 首次约 3 MB',
  matplotlib: '绘图与可视化 · 首次约 12 MB',
  pandas: '表格数据分析 · 首次约 8 MB',
}

export function OutputPanel(props: OutputPanelProps) {
  const [tab, setTab] = useState<'output' | 'learn' | 'packages'>('output')
  const [input, setInput] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    props.onSubmitInput(input)
    setInput('')
  }

  return (
    <section className="output-panel" aria-label="运行结果">
      <header className="panel-tabs">
        <div role="tablist" aria-label="辅助面板">
          <button role="tab" aria-selected={tab === 'output'} onClick={() => setTab('output')}>输出</button>
          <button role="tab" aria-selected={tab === 'learn'} onClick={() => setTab('learn')}>速查</button>
          <button role="tab" aria-selected={tab === 'packages'} onClick={() => setTab('packages')}>扩展包</button>
        </div>
        <span className={`runtime-pill ${props.status}`}>{props.statusMessage}</span>
        {tab === 'output' && <button className="text-button" onClick={props.onClear}>清空</button>}
      </header>
      <div className="panel-content">
        {tab === 'output' && (
          <div className="console" aria-live="polite">
            {props.items.length === 0 && <p className="empty-hint">运行代码后，结果会显示在这里。</p>}
            {props.items.map((item) => item.kind === 'plot' ? (
              <img key={item.id} src={item.dataUrl} alt="Python 生成的图表" className="plot-output" />
            ) : item.kind === 'exception' ? (
              <article className="exception-card" key={item.id}>
                <pre>{item.text}</pre>
                {item.explanation && (
                  <div className="error-help">
                    <strong>{item.explanation.title}</strong>
                    {item.explanation.line && <span>出错行：{item.explanation.line}</span>}
                    <p>{item.explanation.explanation}</p>
                    <ul>{item.explanation.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
                  </div>
                )}
              </article>
            ) : <pre key={item.id} className={item.kind}>{item.text}</pre>)}
            {props.waitingForInput && (
              <form className="stdin-form" onSubmit={submit}>
                <label htmlFor="stdin-value">程序输入</label>
                <input id="stdin-value" aria-label="程序输入" value={input} onChange={(event) => setInput(event.target.value)} autoFocus />
                <button type="submit" className="primary-button">提交输入</button>
              </form>
            )}
          </div>
        )}
        {tab === 'learn' && (
          <div className="cheat-grid">
            {cheatSheet.map(([label, code]) => <button key={label} onClick={() => navigator.clipboard?.writeText(code)}><span>{label}</span><code>{code}</code></button>)}
          </div>
        )}
        {tab === 'packages' && (
          <div className="package-list">
            {(['numpy', 'matplotlib', 'pandas'] as SupportedPackage[]).map((name) => (
              <div key={name} className="package-row">
                <div><strong>{name}</strong><p>{packageDetails[name]}</p></div>
                <button onClick={() => props.onInstallPackage(name)}>{props.packageMessages[name] ?? '准备离线包'}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
