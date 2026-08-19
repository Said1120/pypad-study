import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { App, type RuntimeService, type WorkspaceStore } from './App'
import { createStarterWorkspace, type Workspace } from './domain/workspace'
import type { AppSettings, PackageRecord } from './platform/workspaceRepository'
import type { RuntimeEvent, SupportedPackage } from './runtime/protocol'

class MemoryStore implements WorkspaceStore {
  workspaces: Workspace[] = []
  settings?: AppSettings
  packages: PackageRecord[] = []

  async listProjects() { return this.workspaces.map((item) => item.project) }
  async load(id: string) { return this.workspaces.find((item) => item.project.id === id) ?? null }
  async save(workspace: Workspace) {
    this.workspaces = [...this.workspaces.filter((item) => item.project.id !== workspace.project.id), structuredClone(workspace)]
  }
  async delete(id: string) { this.workspaces = this.workspaces.filter((item) => item.project.id !== id) }
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
    store.settings = { id: 'singleton', fontSize: 19, sidebarOpen: false, outputOpen: true }
    store.packages = [{ name: 'numpy', status: 'ready', version: '2', updatedAt: 100 }]

    render(<App store={store} runtime={new FakeRuntime()} />)
    await screen.findByRole('navigation', { name: '项目文件' })

    expect(screen.getByText('19px')).toBeInTheDocument()
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
})
