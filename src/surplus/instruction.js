// Manual-launch instruction for a suggested idea (FR-011): text the user copies and runs themselves.
// Pure and deterministic: no clock, no browser or Node APIs. Nothing here is executed or shell-quoted.
import { SERVICES } from '../data/services.js'
import { SUPPORTED_SERVICE_IDS } from './constants.js'

// Official non-interactive commands per tool (contracts/runner-cli.md).
const TOOL_COMMANDS = Object.freeze({
  claude: 'claude -p',
  codex: 'codex exec',
})

const NONE = '(none given)'

const present = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null)

// idea: { text, context?, workingFolder? }. service: a supported service id ('claude' or 'chatgpt').
// Returns plain text with the idea, its context, the working folder as typed and the tool command.
export function buildManualInstruction(idea, service) {
  if (!SUPPORTED_SERVICE_IDS.includes(service)) {
    throw new TypeError(`Unsupported service for manual instruction: ${String(service)}`)
  }
  const definition = SERVICES.find((s) => s.id === service)
  const tool = definition?.surplus?.tool
  const command = TOOL_COMMANDS[tool]
  if (!command) throw new TypeError(`No tool command for service: ${service}`)

  const context = present(idea.context) ?? NONE
  const folder = present(idea.workingFolder) ?? NONE

  return [
    `Task for ${definition.name}:`,
    idea.text,
    '',
    'Context:',
    context,
    '',
    `Working folder: ${folder}`,
    `Tool command: ${command}`,
  ].join('\n')
}
