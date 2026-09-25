# Claude Code repository guide

Read [AGENTS.md](AGENTS.md) before changing runtime behaviour and
[CONTRIBUTING.md](CONTRIBUTING.md) before preparing a release. Keep `scroll-animation` focused on
motion for editorial and creative sites; UI micro-interactions and layout scaling are out of scope.

The runtime pack is `skills/scroll-animation/`; everything else is repository tooling. Run
`npm run verify` (`scripts/check-sync`, then `npm test`) after every runtime, routing, metadata,
documentation or evaluation change. Keep `package.json`, `.codex-plugin/plugin.json` and the
newest `CHANGELOG.md` release in step. Commit only the paths you changed, with conventional
messages; never push or tag unless asked.
