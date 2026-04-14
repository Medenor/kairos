import { requireFields, parseJsonBody } from '../validation.js'
import { requireAuth } from '../../auth/middleware.js'
import { ApiError } from '../errors.js'

function requireWorkspaceAccess(ctx, workspaceId) {
  const auth = requireAuth(ctx)
  const membership = ctx.repos.workspaceMember.getMembership(workspaceId, auth.user.id)
  if (!membership) {
    ctx.services.securityEvents.log('access_denied', {
      userId: auth.user.id,
      workspaceId,
      sourceIp: ctx.req.socket.remoteAddress,
      metadata: { reason: 'not_member' },
    })
    throw new ApiError(403, 'FORBIDDEN', 'Not a member of this workspace')
  }
  return auth
}

export function registerRecordRoutes(addRoute, deps) {
  addRoute('GET', '/api/v1/workspaces/:workspaceId/records', async (ctx) => {
    const auth = requireWorkspaceAccess({ ...ctx, ...deps }, ctx.params.workspaceId)
    const since = ctx.url.searchParams.get('since')
    const result = deps.services.sharedRecords.list(ctx.params.workspaceId, since)
    return { status: 200, body: result, auth }
  })

  addRoute('POST', '/api/v1/workspaces/:workspaceId/records', async (ctx) => {
    const auth = requireWorkspaceAccess({ ...ctx, ...deps }, ctx.params.workspaceId)
    const body = await parseJsonBody(ctx.req)
    requireFields(body, ['record_type', 'logical_key', 'payload'])
    const created = deps.services.sharedRecords.create({
      workspaceId: ctx.params.workspaceId,
      userId: auth.user.id,
      recordType: body.record_type,
      logicalKey: body.logical_key,
      payload: body.payload,
    })
    return { status: 201, body: created }
  })

  addRoute('PUT', '/api/v1/workspaces/:workspaceId/records/:recordId', async (ctx) => {
    const auth = requireWorkspaceAccess({ ...ctx, ...deps }, ctx.params.workspaceId)
    const body = await parseJsonBody(ctx.req)
    requireFields(body, ['expected_version', 'payload'])
    const updated = deps.services.sharedRecords.update({
      workspaceId: ctx.params.workspaceId,
      recordId: ctx.params.recordId,
      userId: auth.user.id,
      expectedVersion: body.expected_version,
      payload: body.payload,
    })
    return { status: 200, body: updated }
  })

  addRoute('DELETE', '/api/v1/workspaces/:workspaceId/records/:recordId', async (ctx) => {
    requireWorkspaceAccess({ ...ctx, ...deps }, ctx.params.workspaceId)
    deps.services.sharedRecords.remove({
      workspaceId: ctx.params.workspaceId,
      recordId: ctx.params.recordId,
    })
    return { status: 204, body: null }
  })
}
