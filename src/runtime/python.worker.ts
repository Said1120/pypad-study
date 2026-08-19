/// <reference lib="webworker" />

import type { PyodideInterface } from 'pyodide'
import type { RuntimeCommand, RuntimeEvent, RuntimeFile, SupportedPackage } from './protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
const projectRoot = '/home/pyodide/project'
let pyodide: PyodideInterface | null = null
let interruptBuffer: Int32Array | null = null
let stdinControl: Int32Array | null = null
let stdinBytes: Uint8Array | null = null
let projectFiles: RuntimeFile[] = []
let interrupted = false
let queue = Promise.resolve()

function emit(event: RuntimeEvent): void {
  scope.postMessage(event)
}

function safePath(path: string): string {
  if (!path || path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error('项目包含不安全的文件路径')
  }
  return `${projectRoot}/${path}`
}

function clearProject(): void {
  if (!pyodide) return
  try {
    pyodide.FS.rmdirTree(projectRoot)
  } catch {
    // It may not exist on first use.
  }
  pyodide.FS.mkdirTree(projectRoot)
}

function configureStreams(): void {
  if (!pyodide || !stdinControl || !stdinBytes) return
  pyodide.setStdout({ batched: (text) => emit({ type: 'stdout', text: `${text}\n` }) })
  pyodide.setStderr({ batched: (text) => emit({ type: 'stderr', text: `${text}\n` }) })
  pyodide.setStdin({
    read(buffer) {
      if (!stdinControl || !stdinBytes || !pyodide) return 0
      Atomics.store(stdinControl, 0, 0)
      Atomics.store(stdinControl, 1, 0)
      emit({ type: 'status', status: 'waiting-input', message: '程序正在等待输入' })
      emit({ type: 'stdinRequest', prompt: '' })
      while (Atomics.load(stdinControl, 0) === 0) {
        Atomics.wait(stdinControl, 0, 0, 100)
        pyodide.checkInterrupt()
      }
      const length = Math.min(Atomics.load(stdinControl, 1), buffer.length)
      buffer.set(stdinBytes.subarray(0, length))
      Atomics.store(stdinControl, 0, 0)
      emit({ type: 'status', status: 'running', message: '正在运行' })
      return length
    },
    isatty: true,
  })
}

async function initialize(command: Extract<RuntimeCommand, { type: 'initialize' }>): Promise<void> {
  emit({ type: 'status', status: 'loading', message: '正在加载 Python…' })
  interruptBuffer = new Int32Array(command.interruptBuffer)
  stdinControl = new Int32Array(command.stdinBuffer, 0, 2)
  stdinBytes = new Uint8Array(command.stdinBuffer, 8)
  const module = await import(/* @vite-ignore */ `${command.indexURL}pyodide.mjs`) as typeof import('pyodide')
  pyodide = await module.loadPyodide({ indexURL: command.indexURL })
  pyodide.setInterruptBuffer(interruptBuffer)
  pyodide.runPython('import os\nos.environ["MPLBACKEND"] = "AGG"')
  clearProject()
  configureStreams()
  emit({ type: 'status', status: 'ready', message: 'Python 已就绪' })
}

function syncProject(files: RuntimeFile[]): void {
  if (!pyodide) throw new Error('Python 尚未初始化')
  clearProject()
  projectFiles = files
  for (const file of files) {
    const fullPath = safePath(file.path)
    pyodide.FS.mkdirTree(fullPath.slice(0, fullPath.lastIndexOf('/')))
    pyodide.FS.writeFile(fullPath, file.content, { encoding: 'utf8' })
  }
}

async function collectPlots(): Promise<void> {
  if (!pyodide) return
  const result = await pyodide.runPythonAsync(`
import base64, io
_pypad_images = []
try:
    import matplotlib.pyplot as _pypad_plt
    for _pypad_number in _pypad_plt.get_fignums():
        _pypad_buffer = io.BytesIO()
        _pypad_plt.figure(_pypad_number).savefig(_pypad_buffer, format="png", bbox_inches="tight")
        _pypad_images.append(base64.b64encode(_pypad_buffer.getvalue()).decode("ascii"))
    _pypad_plt.close("all")
except ModuleNotFoundError:
    pass
_pypad_images
`)
  const images = result?.toJs?.() as string[] | undefined
  result?.destroy?.()
  images?.forEach((image) => emit({ type: 'plot', dataUrl: `data:image/png;base64,${image}` }))
}

async function run(entryPath: string): Promise<void> {
  if (!pyodide || !interruptBuffer) throw new Error('Python 尚未初始化')
  const source = projectFiles.map((file) => file.content).join('\n')
  const startedAt = performance.now()
  interrupted = false
  Atomics.store(interruptBuffer, 0, 0)
  emit({ type: 'status', status: 'running', message: '正在运行' })
  try {
    await pyodide.loadPackagesFromImports(source, {
      messageCallback: (message) => emit({ type: 'status', status: 'loading', message }),
      errorCallback: (message) => emit({ type: 'stderr', text: `${message}\n` }),
    })
    const quotedRoot = JSON.stringify(projectRoot)
    const quotedEntry = JSON.stringify(safePath(entryPath))
    await pyodide.runPythonAsync(`
import os, runpy, sys
os.chdir(${quotedRoot})
if ${quotedRoot} not in sys.path:
    sys.path.insert(0, ${quotedRoot})
runpy.run_path(${quotedEntry}, run_name="__main__")
`)
    await collectPlots()
  } catch (error) {
    interrupted = error instanceof Error && /KeyboardInterrupt/.test(error.message)
    if (!interrupted) emit({ type: 'exception', traceback: error instanceof Error ? error.message : String(error) })
  } finally {
    emit({ type: 'finished', durationMs: Math.round(performance.now() - startedAt), interrupted })
    emit({ type: 'status', status: 'ready', message: interrupted ? '运行已停止' : '运行结束' })
  }
}

async function installPackage(packageName: SupportedPackage): Promise<void> {
  if (!pyodide) throw new Error('Python 尚未初始化')
  emit({ type: 'packageProgress', packageName, status: 'downloading', message: `正在准备 ${packageName}` })
  try {
    await pyodide.loadPackage(packageName, {
      messageCallback: (message) => emit({ type: 'packageProgress', packageName, status: 'downloading', message }),
    })
    emit({ type: 'packageProgress', packageName, status: 'ready', message: `${packageName} 已可离线使用` })
  } catch (error) {
    emit({ type: 'packageProgress', packageName, status: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

async function handle(command: RuntimeCommand): Promise<void> {
  switch (command.type) {
    case 'initialize': await initialize(command); break
    case 'syncProject': syncProject(command.files); break
    case 'run': await run(command.entryPath); break
    case 'installPackage': await installPackage(command.packageName); break
    case 'reset': clearProject(); break
    case 'interrupt': emit({ type: 'status', status: 'stopping', message: '正在停止…' }); break
    case 'provideStdin': break
  }
}

scope.onmessage = ({ data }: MessageEvent<RuntimeCommand>) => {
  if (data.type === 'interrupt' || data.type === 'provideStdin') {
    void handle(data)
    return
  }
  queue = queue.then(() => handle(data)).catch((error) => {
    emit({ type: 'exception', traceback: error instanceof Error ? error.message : String(error) })
    emit({ type: 'status', status: 'error', message: 'Python 运行环境发生错误' })
  })
}
