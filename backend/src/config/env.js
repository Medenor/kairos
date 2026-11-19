import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const envFilePath = resolve(backendDir, '.env')

function parseDotEnv(content) {
  const out = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    out[key] = value
  }
  return out
}

function loadEnvFile(path = envFilePath) {
  if (!existsSync(path)) return {}
  return parseDotEnv(readFileSync(path, 'utf8'))
}

export function resolveDbPath(configuredPath, cwd = process.cwd()) {
  return configuredPath
    ? resolve(cwd, configuredPath)
    : resolve(backendDir, 'data/kairos.db')
}

const fileEnv = loadEnvFile()
const env = { ...fileEnv, ...process.env }

const DEFAULT_SUBNETS = [
  '127.0.0.1/32',
  '::1/128',
  '192.168.0.0/16',
  '10.0.0.0/8',
  '172.16.0.0/12',
]

export const config = {
  host: env.HOST || '0.0.0.0',
  port: Number(env.PORT || 8080),
  apiPrefix: env.API_PREFIX || '/api/v1',
  dbPath: resolveDbPath(env.DB_PATH),
  sessionTtlSeconds: Number(env.AUTH_SESSION_TTL_SECONDS || 43200),
  lanOnly: String(env.LAN_ONLY || 'true').toLowerCase() !== 'false',
  allowedSubnets: (env.ALLOWED_SUBNETS || DEFAULT_SUBNETS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
}
