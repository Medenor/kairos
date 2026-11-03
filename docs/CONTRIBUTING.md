# Contributing

Issues and pull requests are welcome on [Codeberg](https://codeberg.org/medenor/kairos). For anything larger than a small fix, open an issue first so the approach can be discussed.

## Ground rules

Kairos is governed by its [constitution](../.specify/memory/constitution.md). In short, a change should:

1. Improve which-AI-to-use-now decisions or quota visibility.
2. Keep routing rules deterministic and explainable (every recommendation has a reason).
3. Come with verification that fails if the behavior regresses.
4. Add no runtime dependency without written justification (the frontend ships only React).
5. Keep quota data local by default.

## Setup

```bash
git clone https://codeberg.org/medenor/kairos.git
cd kairos
npm ci
npm run dev
```

Full details: [DEVELOPMENT.md](DEVELOPMENT.md).

## Submitting a change

1. Search existing issues and PRs.
2. Fork, then branch: `git checkout -b feat/short-name` (see [agents/git-workflow.md](agents/git-workflow.md)).
3. Write the change with tests. Routing-rule changes need a before/after scenario.
4. Run `npm run lint && npm test && npm run build`.
5. Update `CHANGELOG.md` under `[UNRELEASED]` for user-visible changes.
6. Commit with [Conventional Commits](https://www.conventionalcommits.org) (`feat(rules): …`).
7. Push and open a PR with the template filled in: behavior change, verification evidence, any dependency added.

## Reporting bugs and security issues

Use the issue templates for bugs and feature requests. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of filing a public issue.

## AI-assisted contributions

This project is built with AI collaboration (see the README disclaimer). AI-assisted changes are held to the same standard: a human reviews, tests and takes responsibility for them.

## License

By contributing you agree your work is licensed under AGPL-3.0-or-later, the project license.
