import { requireAuth } from '../../auth/middleware.js'
import { ApiError } from '../errors.js'

export function registerSyncRoutes(addRoute, deps) {
  addRoute('GET', '/api/v1/workspaces/:workspaceId/sync/pull', async (ctx) => {
    const auth = requireAuth({ ...ctx, services: deps.services, db: deps.db })
    const membership = deps.repos.workspaceMember.getMembership(ctx.params.workspaceId, auth.user.id)
    if (!membership) throw new ApiError(403, 'FORBIDDEN', 'Not a member of this workspace')
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
