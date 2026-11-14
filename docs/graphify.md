# Graphify source map

Graphify is an **optional local source-navigation aid**. It is not part of the application, production build, or license checks. The separate GitHub Actions workflow uploads a code-only graph as a short-lived artifact. It does not use Graphify Cloud, a model API, Supabase, or credentials.

## Build once per checkout

Use Python 3.10+ and `uv` when available:

```sh
uvx --from graphifyy==0.9.108 graphify extract . --code-only
```

The source-only graph is stored at `graphify-out/graph.json`. The tracked `.graphifyignore` excludes encrypted question banks, media, credentials, dependencies, and generated directories. Avoid changing those exclusions for convenience.

## Query before broad code searches

```sh
uvx --from graphifyy==0.9.108 graphify query "what connects offline question storage to license enforcement?" --graph graphify-out/graph.json
uvx --from graphifyy==0.9.108 graphify path "QuestionBank" "License" --graph graphify-out/graph.json
```

Rebuild or update the local graph after a significant change or branch checkout. Graph paths are hints, not proof. Read the current source, validate actual callers and behavior, and run the normal tests before editing or declaring success. If a graph is missing, stale, or the CLI cannot run, inspect source normally instead of blocking work.

The GitHub Actions artifact is **not** copied into a browser bundle, Android APK, or public hosting directory. Never add tokens or confidential customer data to it. Graphify code-only extraction is deterministic and does not require an LLM backend; no always-on hooks, machine-wide proxy, or paid hosted service is enabled.
