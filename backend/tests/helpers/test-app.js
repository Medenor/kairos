import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../src/server.js'

export async function startTestApp() {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-app-test-'))
  const dbPath = join(dir, 'app.db')
  const app = createApp({
    dbPath,
    host: '127.0.0.1',
    port: 0,
    seedDemoData: true,
  })
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const fixture = app.db.query('SELECT id, username FROM users WHERE username=\'owner\' LIMIT 1;')[0]
  const workspace = app.db.query('SELECT id FROM workspaces LIMIT 1;')[0]

  async function login() {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'password123' }),
    })
    const json = await response.json()
    return json.session_token
  }

  async function stop() {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }

  return {
    app,
    baseUrl,
    workspaceId: workspace.id,
    userId: fixture.id,
    login,
    stop,
  }
}
