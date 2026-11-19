import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'

const backendDir = resolve(import.meta.dirname, '../..')
const repositoryDir = resolve(backendDir, '..')
const envModuleUrl = new URL('../../src/config/env.js', import.meta.url).href

function readConfig(cwd, extraEnv = {}) {
  const script = [
    `import { config, envFilePath } from ${JSON.stringify(envModuleUrl)}`,
    'process.stdout.write(JSON.stringify({ dbPath: config.dbPath, envFilePath }))',
  ].join(';')

  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd,
    env: { ...process.env, DB_PATH: '', ...extraEnv },
    encoding: 'utf8',
  }))
}

test('default backend paths do not depend on the launch directory', () => {
  const fromRepository = readConfig(repositoryDir)
  const fromBackend = readConfig(backendDir)
  const expectedDbPath = resolve(backendDir, 'data/kairos.db')
  const expectedEnvPath = resolve(backendDir, '.env')

  assert.deepEqual(fromRepository, {
    dbPath: expectedDbPath,
    envFilePath: expectedEnvPath,
  })
  assert.deepEqual(fromBackend, fromRepository)
})

test('explicit DB_PATH overrides the default', () => {
  const configuredPath = resolve(repositoryDir, '.test-tmp/configured-kairos.db')

  assert.equal(readConfig(backendDir, { DB_PATH: configuredPath }).dbPath, configuredPath)
})
