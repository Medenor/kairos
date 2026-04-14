import { ApiError } from '../errors.js'

function resolveWorkspaceActor(deps, workspaceId) {
  const workspace = deps.repos.workspace.getById(workspaceId)
  if (!workspace) throw new ApiError(404, 'NOT_FOUND', 'Workspace not found')
  return workspace.created_by_user_id
}

export function registerBackupRoutes(addRoute, deps) {
  addRoute('POST', '/api/v1/workspaces/:workspaceId/backups', async (ctx) => {
    const userId = resolveWorkspaceActor(deps, ctx.params.workspaceId)
    const snapshot = deps.services.backup.createSnapshot({
      workspaceId: ctx.params.workspaceId,
      userId,
    })
    return { status: 202, body: snapshot }
  })

  addRoute('GET', '/api/v1/workspaces/:workspaceId/backups', async (ctx) => {
    resolveWorkspaceActor(deps, ctx.params.workspaceId)
    return { status: 200, body: deps.services.backup.listSnapshots(ctx.params.workspaceId) }
  })

  addRoute('POST', '/api/v1/workspaces/:workspaceId/backups/:backupId/restore', async (ctx) => {
    const userId = resolveWorkspaceActor(deps, ctx.params.workspaceId)
    const restored = deps.services.backup.restoreSnapshot({
      workspaceId: ctx.params.workspaceId,
      backupId: ctx.params.backupId,
      userId,
    })
    return { status: 202, body: restored }
  })
}
