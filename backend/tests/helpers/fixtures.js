import { randomUUID } from 'node:crypto'
import { hashPassword } from '../../src/auth/password.js'

export function seedDefaultFixture(db) {
  const userId = randomUUID()
  const workspaceId = randomUUID()
  const now = new Date().toISOString()

  db.exec(`
    INSERT INTO users (id, username, password_hash, role, is_active, created_at)
    VALUES ('${userId}', 'owner', '${hashPassword('password123')}', 'owner', 1, '${now}');

    INSERT INTO workspaces (id, name, created_by_user_id, created_at, updated_at)
    VALUES ('${workspaceId}', 'Default Workspace', '${userId}', '${now}', '${now}');

    INSERT INTO workspace_members (workspace_id, user_id, permission, joined_at)
    VALUES ('${workspaceId}', '${userId}', 'admin', '${now}');
  `)

  return { userId, workspaceId, username: 'owner', password: 'password123' }
}
