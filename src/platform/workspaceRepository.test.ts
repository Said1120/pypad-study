import { afterEach, describe, expect, test } from 'vitest'
import { createStarterWorkspace } from '../domain/workspace'
import { PyPadDatabase, WorkspaceRepository } from './workspaceRepository'

const databases: PyPadDatabase[] = []

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('WorkspaceRepository', () => {
  test('persists a project and its files across repository instances', async () => {
    const database = new PyPadDatabase(`pypad-test-${crypto.randomUUID()}`)
    databases.push(database)
    const workspace = createStarterWorkspace('持久化练习', 100, () => crypto.randomUUID())

    await new WorkspaceRepository(database).save(workspace)
    const loaded = await new WorkspaceRepository(database).load(workspace.project.id)

    expect(loaded).toEqual(workspace)
  })

  test('lists projects with the most recently updated first', async () => {
    const database = new PyPadDatabase(`pypad-test-${crypto.randomUUID()}`)
    databases.push(database)
    const repository = new WorkspaceRepository(database)
    await repository.save(createStarterWorkspace('较早', 100, () => crypto.randomUUID()))
    await repository.save(createStarterWorkspace('最近', 200, () => crypto.randomUUID()))

    const projects = await repository.listProjects()

    expect(projects.map((project) => project.name)).toEqual(['最近', '较早'])
  })

  test('persists editor preferences and offline package state', async () => {
    const database = new PyPadDatabase(`pypad-test-${crypto.randomUUID()}`)
    databases.push(database)
    const repository = new WorkspaceRepository(database)
    await repository.saveSettings({ id: 'singleton', fontSize: 18, sidebarOpen: false, outputOpen: true })
    await repository.savePackage({ name: 'numpy', status: 'ready', version: '2', updatedAt: 100 })

    expect(await repository.loadSettings()).toEqual({ id: 'singleton', fontSize: 18, sidebarOpen: false, outputOpen: true })
    expect(await repository.listPackages()).toEqual([{ name: 'numpy', status: 'ready', version: '2', updatedAt: 100 }])
  })
})
