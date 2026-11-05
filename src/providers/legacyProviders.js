// Display-only table of the five fixed services of features 001 to 006. Old records (history,
// runs, cycles, ideas) still carry these ids; this table lets the UI name them as "removed".
// Nothing routes on it and no provider is created from it. With `fixtures/` it is the only
// non-test place allowed to contain these names (guard test src/routing/no-provider-literals.test.js).

export const LEGACY_PROVIDER_NAMES = Object.freeze({
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  copilot: 'GitHub Copilot',
  openrouter: 'OpenRouter',
  kilocode: 'Kilocode',
})
