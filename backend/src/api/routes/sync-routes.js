import { ApiError } from '../errors.js'

export function registerSyncRoutes(addRoute, deps) {
  addRoute('GET', '/api/v1/workspaces/:workspaceId/sync/pull', async (ctx) => {
    const workspace = deps.repos.workspace.getById(ctx.params.workspaceId)
    if (!workspace) throw new ApiError(404, 'NOT_FOUND', 'Workspace not found')
    const cursor = ctx.url.searchParams.get('cursor')
    const result = deps.services.sharedRecords.list(ctx.params.workspaceId, cursor)
    return {
      status: 200,
      body: {
        items: result.items,
        next_cursor: result.sync_cursor,
      },
    }
  })
}
