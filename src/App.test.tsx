import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { App, type RuntimeService, type WorkspaceStore } from './App'
import { createStarterWorkspace, type Workspace } from './domain/workspace'
import { exportWorkspaceZip } from './platform/workspaceArchive'
import type { AppSettings, PackageRecord } from './platform/workspaceRepository'
import type { RuntimeEvent, SupportedPackage } from './runtime/protocol'

class MemoryStore implements WorkspaceStore {
  workspaces: Workspace[] = []
  settings?: AppSettings
  packages: PackageRecord[] = []
  saveDelays: number[] = []
  deleteDelay = 0

  async listProjects() { return this.workspaces.map((item) => item.project) }
  async load(id: string) { return this.workspaces.find((item) => item.project.id === id) ?? null }
  async save(workspace: Workspace) {
    const delay = this.saveDelays.shift() ?? 0
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    this.workspaces = [...this.workspaces.filter((item) => item.project.id !== workspace.project.id), structuredClone(workspace)]
  }
  async delete(id: string) {
    if (this.deleteDelay) await new Promise((resolve) => setTimeout(resolve, this.deleteDelay))
    this.workspaces = this.workspaces.filter((item) => item.project.id !== id)
  }
  async loadSettings() { return this.settings }
  async saveSettings(settings: AppSettings) { this.settings = settings }
  async listPackages() { return this.packages }
  async savePackage(record: PackageRecord) {
    this.packages = [...this.packages.filter((item) => item.name !== record.name), record]
  }
}

class FakeRuntime implements RuntimeService {
  listener: ((event: RuntimeEvent) => void) | null = null
  run = vi.fn()
  provideStdin = vi.fn()
  interrupt = vi.fn()
  installPackage = vi.fn<(name: SupportedPackage) => void>()
  initialize = vi.fn()
  dispose = vi.fn()
  subscribe(listener: (event: RuntimeEvent) => void) {
    this.listener = listener
    return () => { this.listener = null }
  }
  emit(event: RuntimeEvent) { this.listener?.(event) }
}

describe('PyPad app', () => {
  beforeEach(() => {
    vi.spyOn(window, 'prompt').mockRestore()
  })

  test('creates and shows a starter project on first launch', async () => {
    const store = new MemoryStore()
    render(<App store={store} runtime={new FakeRuntime()} />)

    const tree = await screen.findByRole('navigation', { name: '项目文件' })
    expect(within(tree).getByText('main.py')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'PyPad 学习台' })).toBeInTheDocument()
    expect(store.workspaces[0].nodes[0].content).toContain('你好，PyPad')
  })

  test('creates a Python file from the project toolbar', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    store.workspaces = [createStarterWorkspace('练习', 100, () => crypto.randomUUID())]
    vi.spyOn(window, 'prompt').mockReturnValue('loops.py')
    render(<App store={store} runtime={new FakeRuntime()} />)
    await screen.findByRole('navigation', { name: '项目文件' })

    await user.click(screen.getByRole('button', { name: '新建文件' }))

    expect(within(screen.getByRole('navigation', { name: '项目文件' })).getByText('loops.py')).toBeInTheDocument()
  })

  test('runs the current workspace with Command+Enter', async () => {
    const runtime = new FakeRuntime()
    const store = new MemoryStore()
    store.workspaces = [createStarterWorkspace('练习', 100, () => crypto.randomUUID())]
    render(<App store={store} runtime={runtime} />)
    await screen.findByRole('navigation', { name: '项目文件' })

    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')

    expect(runtime.run).toHaveBeenCalledTimes(1)
  })

  test('shows original traceback and deterministic Chinese guidance', async () => {
    const runtime = new FakeRuntime()
    render(<App store={new MemoryStore()} runtime={runtime} />)
    await screen.findByRole('navigation', { name: '项目文件' })

    act(() => runtime.emit({
      type: 'exception',
      traceback: 'File "/home/pyodide/project/main.py", line 2\nNameError: name \'score\' is not defined',
    }))

    expect(screen.getByText(/NameError: name 'score'/)).toBeInTheDocument()
    expect(screen.getByText('名称尚未定义')).toBeInTheDocument()
    expect(screen.getByText('出错行：2')).toBeInTheDocument()
  })

  test('submits live stdin from the output panel', async () => {
    const user = userEvent.setup()
    const runtime = new FakeRuntime()
    render(<App store={new MemoryStore()} runtime={runtime} />)
    await screen.findByRole('navigation', { name: '项目文件' })
    act(() => runtime.emit({ type: 'stdinRequest', prompt: '你的名字：' }))

    await user.type(screen.getByRole('textbox', { name: '程序输入' }), '小明')
    await user.click(screen.getByRole('button', { name: '提交输入' }))

    await waitFor(() => expect(runtime.provideStdin).toHaveBeenCalledWith('小明'))
  })

  test('restores editor preferences and downloaded package state', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    store.settings = { id: 'singleton', fontSize: 19, sidebarOpen: false, outputOpen: true, sidebarWidth: 300, outputHeight: 260 }
    store.packages = [{ name: 'numpy', status: 'ready', version: '2', updatedAt: 100 }]

    render(<App store={store} runtime={new FakeRuntime()} />)
    await screen.findByRole('navigation', { name: '项目文件' })

    expect(screen.getByText('19px')).toBeInTheDocument()
    expect(document.querySelector('.app-shell')).toHaveStyle({ '--sidebar-width': '300px', '--output-height': '260px' })
    await user.click(screen.getByRole('tab', { name: '扩展包' }))
    expect(screen.getByText('数组与数值计算 · 首次约 3 MB')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'numpy 已可离线使用' })).toBeInTheDocument()
  })

  test('announces when the app is ready for offline use', async () => {
    render(<App store={new MemoryStore()} runtime={new FakeRuntime()} />)
    await screen.findByRole('navigation', { name: '项目文件' })

    act(() => window.dispatchEvent(new CustomEvent('pypad-offline-ready')))

    expect(screen.getByText('可离线使用')).toBeInTheDocument()
  })

  test('flushes the latest edit before immediately creating another project', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    const original = createStarterWorkspace('不能丢失', 100, () => crypto.randomUUID())
    store.workspaces = [original]
    render(<App store={store} runtime={new FakeRuntime()} />)
    const editor = await screen.findByRole('textbox', { name: 'Python 代码编辑器' })

    await user.click(editor)
    await user.keyboard('x')
    vi.spyOn(window, 'prompt').mockReturnValue('新项目')
    await user.click(screen.getByRole('button', { name: '新建项目' }))

    await waitFor(async () => expect((await store.load(original.project.id))?.nodes[0].content).toContain('x'))
  })

  test('creates files inside the folder selected in the project tree', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    store.workspaces = [createStarterWorkspace('文件夹练习', 100, () => crypto.randomUUID())]
    vi.spyOn(window, 'prompt').mockReturnValueOnce('章节').mockReturnValueOnce('inside.py')
    render(<App store={store} runtime={new FakeRuntime()} />)
    await screen.findByRole('navigation', { name: '项目文件' })

    await user.click(screen.getByRole('button', { name: '新建文件夹' }))
    await user.click(screen.getByRole('button', { name: '章节' }))
    await user.click(screen.getByRole('button', { name: '新建文件' }))

    await waitFor(() => expect(store.workspaces.at(-1)?.nodes.some((node) => node.name === 'inside.py')).toBe(true))
    const current = store.workspaces.at(-1)!
    const folder = current.nodes.find((node) => node.name === '章节')
    expect(folder).toBeDefined()
    expect(current.nodes.find((node) => node.name === 'inside.py')?.parentId).toBe(folder!.id)
  })

  test('does not let an older save completion mark a newer edit as saved', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    const original = createStarterWorkspace('保存顺序', 100, () => crypto.randomUUID())
    store.workspaces = [original]
    store.saveDelays = [250]
    render(<App store={store} runtime={new FakeRuntime()} />)
    const editor = await screen.findByRole('textbox', { name: 'Python 代码编辑器' })

    await user.click(editor)
    await user.keyboard('x')
    await new Promise((resolve) => setTimeout(resolve, 500))
    await user.keyboard('y')
    await new Promise((resolve) => setTimeout(resolve, 300))
    vi.spyOn(window, 'prompt').mockReturnValue('后续项目')
    await user.click(screen.getByRole('button', { name: '新建项目' }))

    await waitFor(async () => expect((await store.load(original.project.id))?.nodes[0].content).toContain('xy'))
  })

  test('deletes a project only after confirmation and opens the remaining project', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    const first = createStarterWorkspace('项目一', 100, () => crypto.randomUUID())
    const second = createStarterWorkspace('项目二', 90, () => crypto.randomUUID())
    store.workspaces = [first, second]
    vi.spyOn(window, 'prompt').mockReturnValue('delete')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App store={store} runtime={new FakeRuntime()} />)
    await screen.findByRole('navigation', { name: '项目文件' })

    await user.click(screen.getByRole('button', { name: '项目操作' }))

    await waitFor(() => expect(store.workspaces.some((item) => item.project.id === first.project.id)).toBe(false))
    expect(screen.getByRole('combobox', { name: '项目' })).toHaveValue(second.project.id)
  })

  test('locks editing for the entire project transition', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    const original = createStarterWorkspace('并发编辑', 100, () => crypto.randomUUID())
    store.workspaces = [original]
    store.saveDelays = [50, 300]
    vi.spyOn(window, 'prompt').mockReturnValue('新项目')
    render(<App store={store} runtime={new FakeRuntime()} />)
    const editor = await screen.findByRole('textbox', { name: 'Python 代码编辑器' })
    await user.click(editor)
    await user.keyboard('x')

    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(editor).toHaveAttribute('contenteditable', 'false')
    await user.click(editor)
    await user.keyboard('y')

    await waitFor(async () => expect((await store.load(original.project.id))?.nodes[0].content).toBe(`x${original.nodes[0].content}`), { timeout: 2000 })
  })

  test('does not let a queued autosave recreate a deleted project', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    const runtime = new FakeRuntime()
    const doomed = createStarterWorkspace('待删除', 100, () => crypto.randomUUID())
    store.workspaces = [doomed]
    store.saveDelays = [350]
    store.deleteDelay = 300
    vi.spyOn(window, 'prompt').mockReturnValue('delete')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App store={store} runtime={runtime} />)
    const editor = await screen.findByRole('textbox', { name: 'Python 代码编辑器' })
    await user.click(editor)
    await user.keyboard('x')
    await new Promise((resolve) => setTimeout(resolve, 500))

    fireEvent.click(screen.getByRole('button', { name: '项目操作' }))
    await screen.findByText('正在安全保存并切换…')
    await waitFor(() => expect(editor).toHaveAttribute('contenteditable', 'false'))
    await user.click(editor)
    await user.keyboard('y')
    expect(screen.getByRole('button', { name: '▶ 运行' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '▶ 运行' }))
    await user.keyboard('{Meta>}s{/Meta}')

    await waitFor(() => expect(store.workspaces.some((item) => item.project.id === doomed.project.id)).toBe(false), { timeout: 2000 })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(store.workspaces.some((item) => item.project.id === doomed.project.id)).toBe(false)
    expect(runtime.run).not.toHaveBeenCalled()
  })

  test('locks running as soon as a ZIP import starts reading', async () => {
    const store = new MemoryStore()
    const runtime = new FakeRuntime()
    store.workspaces = [createStarterWorkspace('当前项目', 100, () => crypto.randomUUID())]
    const imported = createStarterWorkspace('导入项目', 90, () => crypto.randomUUID())
    const archive = exportWorkspaceZip(imported)
    const archiveBuffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer
    let finishReading!: (value: ArrayBuffer) => void
    const reading = new Promise<ArrayBuffer>((resolve) => { finishReading = resolve })
    const file = new File([archiveBuffer], 'project.zip', { type: 'application/zip' })
    Object.defineProperty(file, 'arrayBuffer', { value: vi.fn(() => reading) })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App store={store} runtime={runtime} />)
    await screen.findByRole('navigation', { name: '项目文件' })

    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })

    const runButton = screen.getByRole('button', { name: '▶ 运行' })
    expect(runButton).toBeDisabled()
    fireEvent.click(runButton)
    expect(runtime.run).not.toHaveBeenCalled()

    finishReading(archiveBuffer)
    await waitFor(() => expect(screen.getByRole('combobox', { name: '项目' })).toHaveDisplayValue('导入项目'))
    expect(runButton).toBeEnabled()
  })
})
