export function createSyncPullService(sharedRecordService) {
  return {
    pull(workspaceId, cursor = null) {
      const result = sharedRecordService.list(workspaceId, cursor)
      return {
        items: result.items,
        next_cursor: result.sync_cursor,
      }
    },
  }
}
