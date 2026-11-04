// Manual-launch instruction for a suggested idea (FR-011): text the user copies and runs themselves.
// Pure and deterministic: no clock, no browser or Node APIs. Nothing here is executed or shell-quoted.

// Official non-interactive commands per tool (contracts/runner-cli.md).
const TOOL_COMMANDS = Object.freeze({
  claude: 'claude -p',
  codex: 'codex exec',
})

const NONE = '(none given)'

const present = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null)

// idea: { text, context?, workingFolder? }. service: the runtime provider the idea is suggested for
// ({ name, surplus: { tool } }, as built by src/providers/runtime.js).
// Returns plain text with the idea, its context, the working folder as typed and the tool command.
export function buildManualInstruction(idea, service) {
  const tool = service?.surplus?.tool
  const command = TOOL_COMMANDS[tool]
  if (!command) throw new TypeError(`No tool command for this provider: ${String(service?.name ?? service)}`)

  const context = present(idea.context) ?? NONE
  const folder = present(idea.workingFolder) ?? NONE

  return [
    `Task for ${service.name}:`,
    idea.text,
    '',
    'Context:',
    context,
    '',
    `Working folder: ${folder}`,
    `Tool command: ${command}`,
  ].join('\n')
}
