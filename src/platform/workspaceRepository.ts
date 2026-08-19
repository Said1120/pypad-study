import Dexie, { type EntityTable } from 'dexie'
import type { FileNode, Project, Workspace } from '../domain/workspace'

export interface AppSettings {
  id: 'singleton'
  fontSize: number
  sidebarOpen: boolean
  outputOpen: boolean
  activeProjectId?: string
  activeFileId?: string
}

export interface PackageRecord {
  name: string
  status: 'missing' | 'downloading' | 'ready' | 'error'
  version?: string
  updatedAt: number
  error?: string
}

export class PyPadDatabase extends Dexie {
  projects!: EntityTable<Project, 'id'>
  nodes!: EntityTable<FileNode, 'id'>
  settings!: EntityTable<AppSettings, 'id'>
  packages!: EntityTable<PackageRecord, 'name'>

  constructor(name = 'pypad-study') {
    super(name)
    this.version(1).stores({
      projects: 'id, updatedAt, name',
      nodes: 'id, projectId, [projectId+parentId], updatedAt',
      settings: 'id',
      packages: 'name, status, updatedAt',
    })
  }
}

export class WorkspaceRepository {
  constructor(private readonly database = new PyPadDatabase()) {}

  async save(workspace: Workspace): Promise<void> {
    await this.database.transaction('rw', this.database.projects, this.database.nodes, async () => {
      await this.database.projects.put(workspace.project)
      await this.database.nodes.where('projectId').equals(workspace.project.id).delete()
      await this.database.nodes.bulkPut(workspace.nodes)
    })
  }

  async load(projectId: string): Promise<Workspace | null> {
    const project = await this.database.projects.get(projectId)
    if (!project) return null
    const nodes = await this.database.nodes.where('projectId').equals(projectId).toArray()
    return { project, nodes }
  }

  async listProjects(): Promise<Project[]> {
    return this.database.projects.orderBy('updatedAt').reverse().toArray()
  }

  async delete(projectId: string): Promise<void> {
    await this.database.transaction('rw', this.database.projects, this.database.nodes, async () => {
      await this.database.projects.delete(projectId)
      await this.database.nodes.where('projectId').equals(projectId).delete()
    })
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.database.settings.put(settings)
  }

  async loadSettings(): Promise<AppSettings | undefined> {
    return this.database.settings.get('singleton')
  }

  async savePackage(record: PackageRecord): Promise<void> {
    await this.database.packages.put(record)
  }

  async listPackages(): Promise<PackageRecord[]> {
    return this.database.packages.toArray()
  }
}
