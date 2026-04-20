import { requireFields, parseJsonBody } from '../validation.js'
import { ApiError } from '../errors.js'

function resolveWorkspaceActor(deps, workspaceId) {
  const workspace = deps.repos.workspace.getById(workspaceId)
  if (!workspace) throw new ApiError(404, 'NOT_FOUND', 'Workspace not found')
  return workspace.created_by_user_id
}

export function registerRecordRoutes(addRoute, deps) {
  addRoute('GET', '/api/v1/workspaces/:workspaceId/records', async (ctx) => {
    resolveWorkspaceActor(deps, ctx.params.workspaceId)
    const since = ctx.url.searchParams.get('since')
    const result = deps.services.sharedRecords.list(ctx.params.workspaceId, since)
    return { status: 200, body: result }
  })

  addRoute('POST', '/api/v1/workspaces/:workspaceId/records', async (ctx) => {
    const userId = resolveWorkspaceActor(deps, ctx.params.workspaceId)
    const body = await parseJsonBody(ctx.req)
    requireFields(body, ['record_type', 'logical_key', 'payload'])
    const created = deps.services.sharedRecords.create({
      workspaceId: ctx.params.workspaceId,
      userId,
      recordType: body.record_type,
      logicalKey: body.logical_key,
      payload: body.payload,
    })
    return { status: 201, body: created }
  })

  addRoute('PUT', '/api/v1/workspaces/:workspaceId/records/:recordId', async (ctx) => {
    const userId = resolveWorkspaceActor(deps, ctx.params.workspaceId)
    const body = await parseJsonBody(ctx.req)
    requireFields(body, ['expected_version', 'payload'])
    const updated = deps.services.sharedRecords.update({
      workspaceId: ctx.params.workspaceId,
      recordId: ctx.params.recordId,
      userId,
      expectedVersion: body.expected_version,
      payload: body.payload,
    })
    return { status: 200, body: updated }
  })

  addRoute('DELETE', '/api/v1/workspaces/:workspaceId/records/:recordId', async (ctx) => {
    resolveWorkspaceActor(deps, ctx.params.workspaceId)
    deps.services.sharedRecords.remove({
      workspaceId: ctx.params.workspaceId,
      recordId: ctx.params.recordId,
    })
    return { status: 204, body: null }
  })
}
