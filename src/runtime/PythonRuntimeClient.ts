import type { Workspace } from '../domain/workspace'
import { isRuntimeEvent, workspaceFiles, type RuntimeCommand, type RuntimeEvent, type SupportedPackage } from './protocol'

export interface WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: unknown): void
  terminate(): void
}

interface RuntimeEnvironment {
  sharedArrayBuffer(size: number): SharedArrayBuffer
}

const defaultEnvironment: RuntimeEnvironment = {
  sharedArrayBuffer(size) {
    if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) {
      throw new Error('当前页面未启用安全的线程共享能力，请通过正式 HTTPS 地址打开 PyPad')
    }
    return new SharedArrayBuffer(size)
  },
}

export class PythonRuntimeClient {
  private worker: WorkerLike | null = null
  private interruptBuffer: SharedArrayBuffer | null = null
  private stdinBuffer: SharedArrayBuffer | null = null
  private stopTimer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<(event: RuntimeEvent) => void>()

  constructor(
    private readonly createWorker: () => WorkerLike = () => new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' }),
    private readonly environment: RuntimeEnvironment = defaultEnvironment,
  ) {}

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  initialize(): void {
    if (this.worker) return
    this.interruptBuffer = this.environment.sharedArrayBuffer(4)
    this.stdinBuffer = this.environment.sharedArrayBuffer(8 + 64 * 1024)
    this.worker = this.createWorker()
    this.worker.onmessage = (message) => {
      if (!isRuntimeEvent(message.data)) return
      if (message.data.type === 'finished') this.clearStopTimer()
      this.listeners.forEach((listener) => listener(message.data))
    }
    this.worker.onerror = (error) => {
      this.emit({ type: 'exception', traceback: error.message || 'Python 后台线程意外停止' })
      this.recreateWorker()
    }
    this.post({
      type: 'initialize',
      indexURL: new URL('/pyodide/', globalThis.location?.origin ?? 'http://localhost').toString(),
      interruptBuffer: this.interruptBuffer,
      stdinBuffer: this.stdinBuffer,
    })
  }

  run(workspace: Workspace): void {
    this.ensureWorker()
    const { files, entryPath } = workspaceFiles(workspace)
    this.post({ type: 'syncProject', files })
    this.post({ type: 'run', entryPath })
  }

  installPackage(packageName: SupportedPackage): void {
    this.ensureWorker()
    this.post({ type: 'installPackage', packageName })
  }

  provideStdin(value: string): void {
    if (!this.stdinBuffer) throw new Error('Python 尚未初始化')
    const encoded = new TextEncoder().encode(`${value}\n`)
    const capacity = this.stdinBuffer.byteLength - 8
    if (encoded.length > capacity) throw new Error('单次输入内容过长')
    const control = new Int32Array(this.stdinBuffer, 0, 2)
    new Uint8Array(this.stdinBuffer, 8).fill(0)
    new Uint8Array(this.stdinBuffer, 8, encoded.length).set(encoded)
    Atomics.store(control, 1, encoded.length)
    Atomics.store(control, 0, 1)
    Atomics.notify(control, 0)
    this.post({ type: 'provideStdin' })
  }

  interrupt(): void {
    if (!this.worker || !this.interruptBuffer) return
    const signal = new Int32Array(this.interruptBuffer)
    Atomics.store(signal, 0, 2)
    Atomics.notify(signal, 0)
    this.post({ type: 'interrupt' })
    this.clearStopTimer()
    this.stopTimer = setTimeout(() => this.recreateWorker(), 2000)
  }

  reset(): void {
    if (this.worker) this.post({ type: 'reset' })
    this.recreateWorker()
  }

  dispose(): void {
    this.clearStopTimer()
    this.worker?.terminate()
    this.worker = null
  }

  private ensureWorker(): void {
    if (!this.worker) this.initialize()
  }

  private post(command: RuntimeCommand): void {
    this.worker?.postMessage(command)
  }

  private emit(event: RuntimeEvent): void {
    this.listeners.forEach((listener) => listener(event))
  }

  private recreateWorker(): void {
    this.clearStopTimer()
    this.worker?.terminate()
    this.worker = null
    this.initialize()
  }

  private clearStopTimer(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopTimer = null
  }
}

