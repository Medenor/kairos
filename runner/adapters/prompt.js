// Prompt shared by the adapters (FR-024): built from the idea text and context only.
// No quota data, no other ideas, no paths, whatever else the caller's idea object carries.
// The only thing read from the idea besides text and context is whether it has a working folder (never its path):
// without one (FR-017) the session is told that no project files exist and that the work is limited to drafts.

import { classifyFolder } from '../../src/surplus/paths.js'

export const NEEDS_INPUT_MARKER = 'NEEDS_INPUT:'

export function buildPrompt(idea) {
  const text = typeof idea?.text === 'string' ? idea.text.trim() : ''
  if (!text) throw new Error('buildPrompt: idea text is required')
  const context = typeof idea.context === 'string' ? idea.context.trim() : ''

  const folderless = classifyFolder(idea.workingFolder) === 'empty'
  const parts = [
    'This is a non-interactive session. No human is available and no information can be requested, so do not ask questions: make reasonable assumptions and say what you assumed.',
    folderless
      ? 'There are no project files: the current folder is an empty scratch directory. The work is limited to drafts based on the idea text and its context (research, drafting, review of text contained in the idea or its context). Work only inside the current folder. Everything you produce is a draft that the user will review before using it.'
      : 'Work only inside the current folder, which is a disposable copy. Everything you produce is a draft that the user will review before using it.',
    `If you cannot make progress without information only the user can give, start your final answer with "${NEEDS_INPUT_MARKER}" followed by what you need.`,
    '',
    'Task:',
    text,
  ]
  if (context) parts.push('', 'Context:', context)
  return parts.join('\n')
}
