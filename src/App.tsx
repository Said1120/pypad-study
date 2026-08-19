import { ChangeEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileTree } from './components/FileTree'
import { OutputPanel, type OutputItem } from './components/OutputPanel'
import {
  addFile,
  addFolder,
  createStarterWorkspace,
  duplicateNode,
  removeNode,
  renameNode,
  setEntryFile,
  updateFileContent,
  type FileNode,
  type Project,
  type Workspace,
} from './domain/workspace'
import { explainPythonError } from './learning/explainPythonError'
import { exportWorkspaceZip, importWorkspaceZip } from './platform/workspaceArchive'
import { buildImportPreview } from './platform/importPreview'
import { WorkspaceRepository, type AppSettings, type PackageRecord } from './platform/workspaceRepository'
import { PythonRuntimeClient } from './runtime/PythonRuntimeClient'
import type { RuntimeEvent, RuntimeStatus, SupportedPackage } from './runtime/protocol'

export interface WorkspaceStore {
  listProjects(): Promise<Project[]>
  load(id: string): Promise<Workspace | null>
  save(workspace: Workspace): Promise<void>
  delete(id: string): Promise<void>
  loadSettings?(): Promise<AppSettings | undefined>
  saveSettings?(settings: AppSettings): Promise<void>
  listPackages?(): Promise<PackageRecord[]>
  savePackage?(record: PackageRecord): Promise<void>
}

export interface RuntimeService {
  initialize(): void
  subscribe(listener: (event: RuntimeEvent) => void): () => void
  run(workspace: Workspace): void
  provideStdin(value: string): void
  interrupt(): void
  installPackage(name: SupportedPackage): void
  dispose(): void
}

const defaultStore = new WorkspaceRepository()
const defaultRuntime = new PythonRuntimeClient()
const CodeEditor = lazy(() => import('./components/CodeEditor').then((module) => ({ default: module.CodeEditor })))

type SaveState = 'saved' | 'saving' | 'error'

function download(name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export function App({ store = defaultStore, runtime = defaultRuntime }: { store?: WorkspaceStore; runtime?: RuntimeService }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [activeFileId, setActiveFileId] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [fontSize, setFontSize] = useState(16)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [outputOpen, setOutputOpen] = useState(true)
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>('loading')
  const [runtimeMessage, setRuntimeMessage] = useState('正在准备 Python…')
  const [waitingForInput, setWaitingForInput] = useState(false)
  const [outputs, setOutputs] = useState<OutputItem[]>([])
  const [packageMessages, setPackageMessages] = useState<Partial<Record<SupportedPackage, string>>>({})
  const [offlineReady, setOfflineReady] = useState(false)
  const workspaceRef = useRef<Workspace | null>(null)
  const dirtyRef = useRef(false)
  const settingsReadyRef = useRef(false)
  const importRef = useRef<HTMLInputElement>(null)

  workspaceRef.current = workspace

  const refreshProjects = useCallback(async () => setProjects(await store.listProjects()), [store])

  const persist = useCallback(async (value = workspaceRef.current) => {
    if (!value) return
    setSaveState('saving')
    try {
      await store.save(value)
      dirtyRef.current = false
      setSaveState('saved')
      await refreshProjects()
    } catch (error) {
      console.error(error)
      setSaveState('error')
    }
  }, [refreshProjects, store])

  useEffect(() => {
    let active = true
    void (async () => {
      const [available, settings, savedPackages] = await Promise.all([
        store.listProjects(),
        store.loadSettings?.(),
        store.listPackages?.(),
      ])
      const preferredProject = settings?.activeProjectId
        ? available.find((project) => project.id === settings.activeProjectId)
        : undefined
      let initial = preferredProject
        ? await store.load(preferredProject.id)
        : available[0]
          ? await store.load(available[0].id)
          : null
      if (!initial) {
        initial = createStarterWorkspace()
        await store.save(initial)
      }
      if (!active) return
      if (settings) {
        setFontSize(settings.fontSize)
        setSidebarOpen(settings.sidebarOpen)
        setOutputOpen(settings.outputOpen)
      }
      if (savedPackages) {
        setPackageMessages(Object.fromEntries(savedPackages.map((record) => [
          record.name,
          record.status === 'ready' ? `${record.name} 已可离线使用` : record.error ?? record.status,
        ])))
      }
      setWorkspace(initial)
      const preferredFileId = settings?.activeFileId
      setActiveFileId(preferredFileId && initial.nodes.some((node) => node.id === preferredFileId && node.kind === 'file')
        ? preferredFileId
        : initial.project.entryFileId)
      settingsReadyRef.current = true
      await refreshProjects()
    })()
    return () => { active = false }
  }, [refreshProjects, store])

  useEffect(() => {
    const ready = () => setOfflineReady(true)
    window.addEventListener('pypad-offline-ready', ready)
    return () => window.removeEventListener('pypad-offline-ready', ready)
  }, [])

  useEffect(() => {
    try {
      runtime.initialize()
    } catch (error) {
      setRuntimeStatus('error')
      setRuntimeMessage(error instanceof Error ? error.message : String(error))
    }
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === 'status') {
        setRuntimeStatus(event.status)
        setRuntimeMessage(event.message)
      } else if (event.type === 'stdout' || event.type === 'stderr') {
        setOutputs((items) => [...items, { id: crypto.randomUUID(), kind: event.type, text: event.text }])
      } else if (event.type === 'plot') {
        setOutputs((items) => [...items, { id: crypto.randomUUID(), kind: 'plot', dataUrl: event.dataUrl }])
      } else if (event.type === 'exception') {
        setOutputs((items) => [...items, {
          id: crypto.randomUUID(),
          kind: 'exception',
          text: event.traceback,
          explanation: explainPythonError(event.traceback),
        }])
        setOutputOpen(true)
      } else if (event.type === 'stdinRequest') {
        setWaitingForInput(true)
        setOutputOpen(true)
      } else if (event.type === 'finished') {
        setWaitingForInput(false)
      } else if (event.type === 'packageProgress') {
        setPackageMessages((messages) => ({ ...messages, [event.packageName]: event.message }))
        void store.savePackage?.({
          name: event.packageName,
          status: event.status,
          updatedAt: Date.now(),
          error: event.status === 'error' ? event.message : undefined,
        })
      }
    })
    return () => {
      unsubscribe()
      if (runtime === defaultRuntime) runtime.dispose()
    }
  }, [runtime, store])

  useEffect(() => {
    if (!settingsReadyRef.current || !store.saveSettings) return
    void store.saveSettings({
      id: 'singleton',
      fontSize,
      sidebarOpen,
      outputOpen,
      activeProjectId: workspace?.project.id,
      activeFileId,
    })
  }, [activeFileId, fontSize, outputOpen, sidebarOpen, store, workspace?.project.id])

  useEffect(() => {
    if (!workspace || !dirtyRef.current) return
    setSaveState('saving')
    const timer = setTimeout(() => void persist(workspace), 450)
    return () => clearTimeout(timer)
  }, [persist, workspace])

  useEffect(() => {
    const flush = () => { if (dirtyRef.current) void persist() }
    const visibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [persist])

  const updateWorkspace = useCallback((next: Workspace) => {
    dirtyRef.current = true
    setSaveState('saving')
    setWorkspace(next)
  }, [])

  const run = useCallback(() => {
    const current = workspaceRef.current
    if (!current) return
    void persist(current)
    setOutputs([])
    setOutputOpen(true)
    runtime.run(current)
  }, [persist, runtime])

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === 'Enter') { event.preventDefault(); run() }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void persist() }
      if (event.key === '.') { event.preventDefault(); runtime.interrupt() }
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault()
        const query = window.prompt('输入文件名快速打开')?.toLowerCase()
        const match = workspaceRef.current?.nodes.find((node) => node.kind === 'file' && node.name.toLowerCase().includes(query ?? ''))
        if (match && query) setActiveFileId(match.id)
      }
    }
    document.addEventListener('keydown', shortcuts)
    return () => document.removeEventListener('keydown', shortcuts)
  }, [persist, run, runtime])

  const activeFile = useMemo(() => workspace?.nodes.find((node) => node.id === activeFileId && node.kind === 'file'), [activeFileId, workspace])

  const createFile = () => {
    if (!workspace) return
    const name = window.prompt('新文件名', 'untitled.py')
    if (!name) return
    try {
      const next = addFile(workspace, null, name.endsWith('.py') ? name : `${name}.py`)
      updateWorkspace(next)
      setActiveFileId(next.nodes.at(-1)!.id)
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)) }
  }

  const createFolder = () => {
    if (!workspace) return
    const name = window.prompt('新文件夹名', '练习')
    if (!name) return
    try { updateWorkspace(addFolder(workspace, null, name)) } catch (error) { window.alert(error instanceof Error ? error.message : String(error)) }
  }

  const contextAction = (node: FileNode) => {
    if (!workspace) return
    const action = window.prompt(`操作 ${node.name}：输入 rename、copy、delete${node.kind === 'file' && node.name.endsWith('.py') ? ' 或 entry' : ''}`)
    try {
      if (action === 'rename') {
        const name = window.prompt('新名称', node.name)
        if (name) updateWorkspace(renameNode(workspace, node.id, name))
      } else if (action === 'copy') {
        updateWorkspace(duplicateNode(workspace, node.id))
      } else if (action === 'delete' && window.confirm(`确定删除 ${node.name}？文件夹内的内容也会删除。`)) {
        const next = removeNode(workspace, node.id)
        updateWorkspace(next)
        if (!next.nodes.some((item) => item.id === activeFileId)) setActiveFileId(next.project.entryFileId)
      } else if (action === 'entry') {
        updateWorkspace(setEntryFile(workspace, node.id))
      }
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)) }
  }

  const createProject = async () => {
    const name = window.prompt('项目名称', '新的 Python 项目')
    if (!name) return
    const next = createStarterWorkspace(name)
    await store.save(next)
    setWorkspace(next)
    setActiveFileId(next.project.entryFileId)
    await refreshProjects()
  }

  const switchProject = async (id: string) => {
    await persist()
    const next = await store.load(id)
    if (next) {
      setWorkspace(next)
      setActiveFileId(next.project.entryFileId)
    }
  }

  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const next = importWorkspaceZip(new Uint8Array(await file.arrayBuffer()))
      if (!window.confirm(buildImportPreview(next, projects.map((project) => project.name)))) {
        event.target.value = ''
        return
      }
      await store.save(next)
      setWorkspace(next)
      setActiveFileId(next.project.entryFileId)
      await refreshProjects()
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)) }
    event.target.value = ''
  }

  if (!workspace) return <main className="launch-screen"><h1>PyPad 学习台</h1><p>正在打开你的项目…</p></main>

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-closed'} ${outputOpen ? '' : 'output-closed'}`}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">Py</span><div><h1>PyPad 学习台</h1><p>本地运行 · 自动保存</p></div></div>
        <div className="project-switcher">
          <label htmlFor="project-select">项目</label>
          <select id="project-select" value={workspace.project.id} onChange={(event) => void switchProject(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button className="icon-button" onClick={() => void createProject()} aria-label="新建项目">＋</button>
        </div>
        <div className="top-actions">
          {offlineReady && <span className="offline-ready" role="status">可离线使用</span>}
          <span className={`save-state ${saveState}`}>{saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : '保存失败，请导出备份'}</span>
          <button onClick={() => setSidebarOpen((open) => !open)}>{sidebarOpen ? '隐藏文件' : '显示文件'}</button>
          <button className="stop-button" onClick={() => runtime.interrupt()} disabled={!['running', 'waiting-input', 'stopping'].includes(runtimeStatus)}>停止</button>
          <button className="run-button" onClick={run}>▶ 运行</button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-heading"><strong>{workspace.project.name}</strong><span>项目文件</span></div>
        <div className="file-actions">
          <button onClick={createFile} aria-label="新建文件">＋ 文件</button>
          <button onClick={createFolder} aria-label="新建文件夹">＋ 文件夹</button>
        </div>
        <FileTree workspace={workspace} activeFileId={activeFileId} onOpen={setActiveFileId} onContext={contextAction} />
        <div className="backup-actions">
          <button onClick={() => download(`${workspace.project.name}.zip`, exportWorkspaceZip(workspace))}>导出 ZIP</button>
          <button onClick={() => importRef.current?.click()}>导入项目</button>
          <input ref={importRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => void importProject(event)} />
        </div>
      </aside>

      <main className="editor-area">
        <div className="editor-toolbar">
          <div><span className="python-dot" /> <strong>{activeFile?.name ?? '请选择文件'}</strong>{activeFile?.id === workspace.project.entryFileId && <span className="entry-label">入口文件</span>}</div>
          <div className="editor-options">
            <button onClick={() => setFontSize((size) => Math.max(13, size - 1))} aria-label="减小字体">A−</button>
            <span>{fontSize}px</span>
            <button onClick={() => setFontSize((size) => Math.min(24, size + 1))} aria-label="增大字体">A＋</button>
            <button onClick={() => setOutputOpen((open) => !open)}>{outputOpen ? '隐藏输出' : '显示输出'}</button>
          </div>
        </div>
        {activeFile ? (
          <Suspense fallback={<div className="empty-editor">正在加载代码编辑器…</div>}>
            <CodeEditor value={activeFile.content} fontSize={fontSize} onChange={(content) => updateWorkspace(updateFileContent(workspace, activeFile.id, content))} />
          </Suspense>
        ) : <div className="empty-editor">从左侧选择一个文件开始编辑。</div>}
      </main>

      <OutputPanel
        items={outputs}
        status={runtimeStatus}
        statusMessage={runtimeMessage}
        waitingForInput={waitingForInput}
        onSubmitInput={(value) => { runtime.provideStdin(value); setWaitingForInput(false) }}
        onClear={() => setOutputs([])}
        onInstallPackage={(name) => runtime.installPackage(name)}
        packageMessages={packageMessages}
      />
      <footer className="privacy-strip">代码只在这台设备中运行，不上传、不统计、不接广告。</footer>
    </div>
  )
}
