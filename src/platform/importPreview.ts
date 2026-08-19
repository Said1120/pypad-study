import type { Workspace } from '../domain/workspace'

export function buildImportPreview(workspace: Workspace, existingProjectNames: string[]): string {
  const fileCount = workspace.nodes.filter((node) => node.kind === 'file').length
  const folderCount = workspace.nodes.filter((node) => node.kind === 'folder').length
  const conflict = existingProjectNames.includes(workspace.project.name)
    ? '\n\n已有同名项目；继续后会保留两份，请在项目列表中区分。'
    : ''
  return `准备导入“${workspace.project.name}”\n${fileCount} 个文件，${folderCount} 个文件夹${conflict}\n\n确认导入吗？`
}
