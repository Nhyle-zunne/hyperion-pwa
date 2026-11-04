# Codex Cloud repository tools

This setup vendors instruction-based skills into `.agents/skills/`, with root `AGENTS.md` providing project priorities. A fresh GitHub-connected Codex task must check out the branch containing these files. No package installation, setup script, external symlink, machine-wide config, or secret is needed for the skills.

## Sources and installation

The exact upstream commits, original paths, copied-file SHA-256 hashes, and licenses are recorded in [.agents/upstream-lock.json](../.agents/upstream-lock.json). Files are copied without modification. Associated licenses and Caveman notices are retained in `.agents/licenses/`.

Official guidance consulted:

- [Superpowers README](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/README.md) and [Codex adapter](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/using-superpowers/references/codex-tools.md): upstream currently recommends the Codex plugin marketplace. This repository instead vendors the 15 native skill directories and their supporting resources so Cloud checkouts contain them. This is a repository-scoped adaptation, not a marketplace plugin installation.
- [Ponytail installation](https://github.com/DietrichGebert/ponytail/blob/96608e078b2d5ea607c5c3b8b5a54d1c1fba6846/INSTALL.md): upstream offers a plugin with lifecycle hooks, or copying its native skill. Only the core `ponytail` skill is installed here; optional audit/review/debt commands and hooks are not installed.
- [Caveman installation](https://github.com/JuliusBrussee/caveman/blob/2e068f735253cce28256744804785f01887d9646/INSTALL.md): the skills-only Codex path uses `npx skills add JuliusBrussee/caveman -a codex -g`; the same guide explicitly says to omit `-g` for project scope. The equivalent reviewed file installation here copies the core skill's `SKILL.md` and README into `.agents/skills/caveman/`. No machine-wide CLI installer or SessionStart hook was run.
- [Codex skills documentation](https://developers.openai.com/codex/skills/): repository skills use `.agents/skills/<name>/SKILL.md` with YAML `name` and `description` frontmatter.

## What works

| Feature | Codex Cloud repository setup |
| --- | --- |
| Superpowers planning, debugging, TDD, verification, and review guidance | Available as native skill instructions; relevant shell/build tools must exist in the session. |
| Ponytail simple implementations and dependency restraint | Available as instruction guidance. |
| Caveman concise answers preserving technical facts | Available as instruction guidance. No token savings or billing reduction is guaranteed. |
| Automatic relevance selection | Skill descriptions and `AGENTS.md` guide selection; explicit invocation is the reliable way to request a particular skill. |
| Subagents, model routing, visual companion | Conditional on actual session capabilities and permission; no local configuration is installed or assumed. |
| Plugin lifecycle hooks, persistent mode flags, badges/status lines | Require a separately configured compatible host/runtime; not enabled by this repository. |
| Caveman proxy, middleware, provider routing, compression services, analytics | Require separate runtime/service setup; not installed, configured, or assumed to work in Codex Cloud. |

Upstream helper files are passive resources. Their presence does not start a server, enable hooks, install dependencies, or authorize network access. Hosted-service features and local-runtime adapters are outside this setup.

## Invocation

Start a fresh Codex Cloud task on this branch (or main after merging). Examples:

```text
Use $using-superpowers, $ponytail, and $caveman for this task.
Use $writing-plans to plan this change, then $executing-plans to implement it.
Use $systematic-debugging to investigate this failure.
Use $test-driven-development and $verification-before-completion for this fix.
```

If a host does not offer `$` completion, say: `Read and use .agents/skills/ponytail/SKILL.md` (or the corresponding skill path). These are repository skill names, not plugin-prefixed commands such as `$ponytail:ponytail`. Say `stop caveman` or `stop ponytail` to disable that optional style for the session. Special plugin commands and uninstalled Caveman ultra modes are not part of this setup.

## Verification and updates

Run `node scripts/tests/agent-skills-test.mjs` to check tracked content against the upstream pins, unique names/frontmatter, portable files, and instruction entry points. Native Codex skill discovery can be checked with its `skills/list` app-server method using the repository working directory and `forceReload: true`; it does not require a model turn or install a plugin. A CLI/app-server check validates the native scanner, not the GitHub Cloud UI's branch selection or a preloaded conversation catalog. In a fresh Cloud task, ask Codex to list the repository skills and their file paths to confirm that checkout's catalog.

Verified on 2026-11-04 using the environment's existing Codex 0.163.0 app-server: `skills/list` returned all 17 repository skills enabled, with no discovery errors. No model inference, plugin installation, or hooks were needed. The repository validation also runs in the existing GitHub Actions workflow. Existing Cloud conversations may retain their previously loaded skill catalogs; use a fresh task on the configured branch.

Configuration validation passed, including a negative check that altered vendored bytes are rejected. Project checks passed: `npm run test:security`, `NODE_USE_ENV_PROXY=1 npm run build`, `npm run test:offline-build`, `npm run test:progress-revisions`, `npm run test:saved-data:sql`, and `CHROMIUM_PATH=/usr/bin/chromium npm run test:saved-data:browser`. The browser runner initially expected an absent Playwright browser download; the successful run used the existing system Chromium without installing dependencies. These checks do not exercise the GitHub Cloud UI or production payment flows. No application behavior, production configuration, or records were changed by this setup.

To update: review the official installation docs and upstream changes, choose explicit commits, copy the selected skill directories plus their resources and licenses, regenerate the file hashes/pins, and rerun verification and project checks. Preserve relative paths between Superpowers skills. Do not fetch moving `main` during Cloud setup or silently auto-update vendored instructions. Review any new hook, runtime, network, or authorization requirements separately. No upstream AGENTS.md was copied over Hyperion's project instructions.
