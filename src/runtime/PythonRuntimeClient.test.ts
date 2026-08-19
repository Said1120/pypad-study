import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createStarterWorkspace } from '../domain/workspace'
import { PythonRuntimeClient, type WorkerLike } from './PythonRuntimeClient'

class FakeWorker implements WorkerLike {
  messages: unknown[] = []
  terminated = false
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent)
  }
}

describe('PythonRuntimeClient', () => {
  beforeEach(() => vi.useRealTimers())

  test('initializes shared channels then sends project sync before run', () => {
    const worker = new FakeWorker()
    const client = new PythonRuntimeClient(() => worker, { sharedArrayBuffer: (size) => new SharedArrayBuffer(size) })
    const workspace = createStarterWorkspace('项目', 100, () => crypto.randomUUID())

    client.initialize()
    worker.emit({ type: 'status', status: 'ready', message: 'Python 已就绪' })
    client.run(workspace)

    expect(worker.messages.map((message) => (message as { type: string }).type)).toEqual(['initialize', 'syncProject', 'run'])
    expect(worker.messages[2]).toEqual(expect.objectContaining({ type: 'run', entryPath: 'main.py' }))
  })

  test('writes a requested input line into the shared stdin channel', () => {
    const worker = new FakeWorker()
    const client = new PythonRuntimeClient(() => worker, { sharedArrayBuffer: (size) => new SharedArrayBuffer(size) })
    client.initialize()

    client.provideStdin('小明')

    const initialize = worker.messages[0] as { stdinBuffer: SharedArrayBuffer }
    const control = new Int32Array(initialize.stdinBuffer, 0, 2)
    const bytes = new Uint8Array(initialize.stdinBuffer, 8, control[1])
    expect(new TextDecoder().decode(bytes)).toBe('小明\n')
    expect(control[0]).toBe(1)
  })

  test('recreates the worker when interrupt has not finished after two seconds', () => {
    vi.useFakeTimers()
    const workers = [new FakeWorker(), new FakeWorker()]
    const client = new PythonRuntimeClient(() => workers.shift()!, { sharedArrayBuffer: (size) => new SharedArrayBuffer(size) })
    client.initialize()

    client.interrupt()
    vi.advanceTimersByTime(2001)

    expect(workers).toHaveLength(0)
  })
})

