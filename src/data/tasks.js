// Fixed list of task types a recommendation is computed for.
// Providers declare how well they fit each of these (see src/providers/schema.js).

export const TASKS = [
  {
    id: 'coding_hard',
    name: 'Heavy coding',
    desc: 'Architecture, complex debug, refactoring',
  },
  {
    id: 'coding_light',
    name: 'Light coding',
    desc: 'Completion, snippets, quick fixes',
  },
  {
    id: 'work_heavy',
    name: 'Intensive work task',
    desc: 'Writing, analysis, reports, work',
  },
  {
    id: 'daily_chat',
    name: 'Daily chat',
    desc: 'Quick questions, brainstorming',
  },
  {
    id: 'oneshot',
    name: 'API one-shot',
    desc: 'Punctual script, test, automation',
  },
]
