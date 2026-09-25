# Evaluation fixtures

Four layers, each answering one question about `skills/scroll-animation`, so a regression points
at the part that broke: the description, the route table, the method, or a compression pass.

| Layer | Question | Files |
|---|---|---|
| `activation/` | Should the skill trigger? | `cases.json`: prompts with `should_trigger` true and false (near misses owned by neighbours: UI micro-interactions, carousels, fluid type scales, alpha video) |
| `traversal/` | Did the skill read the smallest sufficient reference set? | `cases.json`: `expected_references` and `forbidden_references`, paths under `skills/scroll-animation/` |
| `output/` | Did the work satisfy the artifact and completion contracts? | `cases.json` (portable shape) and `evals.json` (the skill-creator format the four cases started in) |
| `compression-ablation/` | Does a shorter SKILL.md keep quality against the current one and a no-skill baseline? | `cases.json`, each hinging on one `load_bearing_instruction` |

`scripts/check-sync` (through `scripts/lint-skill`) validates every layer: each file is a
non-empty JSON array with no placeholders, activation has both trigger values, and every
traversal path exists in the pack. Update a traversal case whenever a reference is renamed or a
route moves. The v2 rebuild grows these cases with each track.
