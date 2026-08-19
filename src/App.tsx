import { ChangeEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { FileTree } from './components/FileTree'
import { OutputPanel, type OutputItem } from './components/OutputPanel'
import {
  addFile,
  addFolder,
  createStarterWorkspace,
  duplicateNode,
  moveNode,
  removeNode,
  renameProject,
  renameNode,
  setEntryFile,
  updateFileContent,
  type FileNode,
  type Project,
  type Workspace,
} from './domain/workspace'
import { explainPythonError } from './learning/explainPythonError'
import { explainPackageError } from './learning/explainPackageError'
import { exportWorkspaceZip, importWorkspaceZip, MAX_ARCHIVE_BYTES } from './platform/workspaceArchive'
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
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function App({ store = defaultStore, runtime = defaultRuntime }: { store?: WorkspaceStore; runtime?: RuntimeService }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [activeFileId, setActiveFileId] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [fontSize, setFontSize] = useState(16)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [outputOpen, setOutputOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(246)
  const [outputHeight, setOutputHeight] = useState(280)
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>('loading')
  const [runtimeMessage, setRuntimeMessage] = useState('正在准备 Python…')
  const [waitingForInput, setWaitingForInput] = useState(false)
  const [outputs, setOutputs] = useState<OutputItem[]>([])
  const [packageMessages, setPackageMessages] = useState<Partial<Record<SupportedPackage, string>>>({})
  const [offlineReady, setOfflineReady] = useState(false)
  const workspaceRef = useRef<Workspace | null>(null)
  const dirtyRef = useRef(false)
  const revisionRef = useRef(0)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const settingsReadyRef = useRef(false)
  const importRef = useRef<HTMLInputElement>(null)

  workspaceRef.current = workspace

  const refreshProjects = useCallback(async () => setProjects(await store.listProjects()), [store])

  const persist = useCallback(async (value = workspaceRef.current, revision = revisionRef.current): Promise<boolean> => {
    if (!value) return true
    const snapshot = structuredClone(value)
    setSaveState('saving')
    const saveTask = saveQueueRef.current
      .catch(() => undefined)
      .then(() => store.save(snapshot))
    saveQueueRef.current = saveTask.then(() => undefined, () => undefined)
    try {
      await saveTask
      const isLatest = revisionRef.current === revision && workspaceRef.current?.project.id === snapshot.project.id
      if (isLatest) {
        dirtyRef.current = false
        setSaveState('saved')
      }
      await refreshProjects()
      return true
    } catch (error) {
      console.error(error)
      if (revisionRef.current === revision && workspaceRef.current?.project.id === snapshot.project.id) setSaveState('error')
      return false
    }
  }, [refreshProjects, store])

  const flushCurrentWorkspace = useCallback(async (): Promise<boolean> => {
    const projectId = workspaceRef.current?.project.id
    if (!projectId) return true
    while (workspaceRef.current?.project.id === projectId) {
      const revision = revisionRef.current
      if (!dirtyRef.current) {
        await saveQueueRef.current
        if (!dirtyRef.current && revisionRef.current === revision) return true
        continue
      }
      if (!(await persist(workspaceRef.current, revision))) return false
      if (!dirtyRef.current && revisionRef.current === revision) return true
    }
    return false
  }, [persist])

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
        if (settings.sidebarWidth) setSidebarWidth(settings.sidebarWidth)
        if (settings.outputHeight) setOutputHeight(settings.outputHeight)
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
        const packageMessage = event.status === 'error' ? explainPackageError(event.message, navigator.onLine) : event.message
        setPackageMessages((messages) => ({ ...messages, [event.packageName]: packageMessage }))
        void store.savePackage?.({
          name: event.packageName,
          status: event.status,
          updatedAt: Date.now(),
          error: event.status === 'error' ? packageMessage : undefined,
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
      sidebarWidth,
      outputHeight,
      activeProjectId: workspace?.project.id,
      activeFileId,
    })
  }, [activeFileId, fontSize, outputHeight, outputOpen, sidebarOpen, sidebarWidth, store, workspace?.project.id])

  useEffect(() => {
    if (!workspace || !dirtyRef.current) return
    setSaveState('saving')
    const timer = setTimeout(() => { if (dirtyRef.current) void persist(workspace) }, 450)
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
    revisionRef.current += 1
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

  const resizeSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) setSidebarWidth(Math.max(190, Math.min(360, event.clientX)))
  }

  const resizeOutput = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      setOutputHeight(Math.max(160, Math.min(480, window.innerHeight - event.clientY - 28)))
    }
  }

  const createFile = () => {
    if (!workspace) return
    const name = window.prompt('新文件名', 'untitled.py')
    if (!name) return
    try {
      const next = addFile(workspace, selectedFolderId, name.endsWith('.py') ? name : `${name}.py`)
      updateWorkspace(next)
      setActiveFileId(next.nodes.at(-1)!.id)
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)) }
  }

  const createFolder = () => {
    if (!workspace) return
    const name = window.prompt('新文件夹名', '练习')
    if (!name) return
    try { updateWorkspace(addFolder(workspace, selectedFolderId, name)) } catch (error) { window.alert(error instanceof Error ? error.message : String(error)) }
  }

  const contextAction = (node: FileNode) => {
    if (!workspace) return
    const action = window.prompt(`操作 ${node.name}：输入 rename、copy、move、delete${node.kind === 'file' && node.name.endsWith('.py') ? ' 或 entry' : ''}`)
    try {
      if (action === 'rename') {
        const name = window.prompt('新名称', node.name)
        if (name) updateWorkspace(renameNode(workspace, node.id, name))
      } else if (action === 'copy') {
        updateWorkspace(duplicateNode(workspace, node.id))
      } else if (action === 'move') {
        updateWorkspace(moveNode(workspace, node.id, selectedFolderId))
      } else if (action === 'delete' && window.confirm(`确定删除 ${node.name}？文件夹内的内容也会删除。`)) {
        const next = removeNode(workspace, node.id)
        updateWorkspace(next)
        if (node.id === selectedFolderId || !next.nodes.some((item) => item.id === selectedFolderId)) setSelectedFolderId(null)
        if (!next.nodes.some((item) => item.id === activeFileId)) setActiveFileId(next.project.entryFileId)
      } else if (action === 'entry') {
        updateWorkspace(setEntryFile(workspace, node.id))
      }
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)) }
  }

  const createProject = async () => {
    const name = window.prompt('项目名称', '新的 Python 项目')
    if (!name) return
    if (!(await flushCurrentWorkspace())) {
      window.alert('当前项目保存失败。请先导出 ZIP 备份，再切换项目。')
      return
    }
    try {
      const next = createStarterWorkspace(name)
      await store.save(next)
      setWorkspace(next)
      setActiveFileId(next.project.entryFileId)
      setSelectedFolderId(null)
      await refreshProjects()
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)) }
  }

  const projectAction = async () => {
    if (!workspace) return
    const action = window.prompt(`操作“${workspace.project.name}”：输入 rename、copy 或 delete`)
    if (action === 'rename') {
      const name = window.prompt('新的项目名称', workspace.project.name)
      if (!name) return
      try { updateWorkspace(renameProject(workspace, name)) } catch (error) { window.alert(error instanceof Error ? error.message : String(error)) }
    } else if (action === 'copy') {
      if (!(await flushCurrentWorkspace())) {
        window.alert('当前项目保存失败。请先导出 ZIP 备份，再复制项目。')
        return
      }
      const current = workspaceRef.current
      if (!current) return
      const copyNameWith = (label: string) => `${current.project.name.slice(0, 120 - label.length)}${label}`
      let name = copyNameWith(' 副本')
      let suffix = 2
      while (projects.some((project) => project.name === name)) name = copyNameWith(` 副本 ${suffix++}`)
      const next = renameProject(importWorkspaceZip(exportWorkspaceZip(current)), name)
      await store.save(next)
      setWorkspace(next)
      setActiveFileId(next.project.entryFileId)
      setSelectedFolderId(null)
      await refreshProjects()
    } else if (action === 'delete' && window.confirm(`确定删除项目“${workspace.project.name}”？此操作不能撤销，请先导出 ZIP 备份。`)) {
      if (!(await flushCurrentWorkspace())) {
        window.alert('当前项目保存失败。请先导出 ZIP 备份，再删除项目。')
        return
      }
      const deleteTask = saveQueueRef.current.catch(() => undefined).then(() => store.delete(workspace.project.id))
      saveQueueRef.current = deleteTask.then(() => undefined, () => undefined)
      await deleteTask
      const remaining = await store.listProjects()
      let next = remaining[0] ? await store.load(remaining[0].id) : null
      if (!next) {
        next = createStarterWorkspace()
        await store.save(next)
      }
      setWorkspace(next)
      setActiveFileId(next.project.entryFileId)
      setSelectedFolderId(null)
      dirtyRef.current = false
      setSaveState('saved')
      await refreshProjects()
    }
  }

  const switchProject = async (id: string) => {
    if (!(await flushCurrentWorkspace())) {
      window.alert('当前项目保存失败。请先导出 ZIP 备份，再切换项目。')
      return
    }
    const next = await store.load(id)
    if (next) {
      setWorkspace(next)
      setActiveFileId(next.project.entryFileId)
      setSelectedFolderId(null)
    }
  }

  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      if (file.size > MAX_ARCHIVE_BYTES) throw new Error('ZIP 超过 10 MB，无法安全导入')
      const next = importWorkspaceZip(new Uint8Array(await file.arrayBuffer()))
      if (!window.confirm(buildImportPreview(next, projects.map((project) => project.name)))) {
        event.target.value = ''
        return
      }
      if (!(await flushCurrentWorkspace())) {
        window.alert('当前项目保存失败。请先导出 ZIP 备份，再导入项目。')
        event.target.value = ''
        return
      }
      await store.save(next)
      setWorkspace(next)
      setActiveFileId(next.project.entryFileId)
      setSelectedFolderId(null)
      await refreshProjects()
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)) }
    event.target.value = ''
  }

  const exportProject = () => {
    if (!workspace) return
    try { download(`${workspace.project.name}.zip`, exportWorkspaceZip(workspace)) }
    catch (error) { window.alert(error instanceof Error ? error.message : String(error)) }
  }

  if (!workspace) return <main className="launch-screen"><h1>PyPad 学习台</h1><p>正在打开你的项目…</p></main>

  return (
    <div
      className={`app-shell ${sidebarOpen ? '' : 'sidebar-closed'} ${outputOpen ? '' : 'output-closed'}`}
      style={{ '--sidebar-width': `${sidebarWidth}px`, '--output-height': `${outputHeight}px` } as React.CSSProperties}
    >
      <header className="topbar">
        <div className="brand"><span className="brand-mark">Py</span><div><h1>PyPad 学习台</h1><p>本地运行 · 自动保存</p></div></div>
        <div className="project-switcher">
          <label htmlFor="project-select">项目</label>
          <select id="project-select" value={workspace.project.id} onChange={(event) => void switchProject(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button className="icon-button" onClick={() => void createProject()} aria-label="新建项目">＋</button>
          <button className="icon-button" onClick={() => void projectAction()} aria-label="项目操作">•••</button>
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
        <div className="folder-target">
          <span>新内容放在：{workspace.nodes.find((node) => node.id === selectedFolderId)?.name ?? '根目录'}</span>
          {selectedFolderId && <button onClick={() => setSelectedFolderId(null)}>回到根目录</button>}
        </div>
        <FileTree
          workspace={workspace}
          activeFileId={activeFileId}
          activeFolderId={selectedFolderId}
          onOpen={setActiveFileId}
          onSelectFolder={setSelectedFolderId}
          onContext={contextAction}
        />
        <div className="backup-actions">
          <button onClick={exportProject}>导出 ZIP</button>
          <button onClick={() => importRef.current?.click()}>导入项目</button>
          <input ref={importRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => void importProject(event)} />
        </div>
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="调整文件面板宽度"
          aria-orientation="vertical"
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={resizeSidebar}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        />
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

      <div
        className="output-resizer"
        role="separator"
        aria-label="调整输出面板高度"
        aria-orientation="horizontal"
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={resizeOutput}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      />
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
