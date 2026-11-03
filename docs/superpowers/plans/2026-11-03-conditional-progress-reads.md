# Conditional Progress Reads Implementation Plan

> Implement inline, using the executing-plans skill.

**Goal:** Avoid sending unchanged saved-progress snapshots to Android.
**Architecture:** Optional authenticated snapshot hash on existing read action;
account-scoped in-memory Android response cache feeds the unchanged merge flow.
**Tech Stack:** Deno TypeScript, Kotlin, JSONObject, JUnit.
**Spec:** ../specs/2026-11-03-conditional-progress-reads-design.md

## Constraints and review focus
Never skip fresh authorization/sanitization; preserve conflicts and local edits.
Avoid mutable cache aliasing and cross-account reuse. Missing records and legacy
servers must preserve their full-read behavior. No saved-data migrations/deletes.

## Tasks
- [ ] Add failing real-handler tests for conditional replies and access failures.
- [ ] Implement hash comparison after sanitization; run all Edge tests and security checks.
- [ ] Add failing JVM cache tests, then implement immutable account-scoped cache.
- [ ] Integrate cache reads/invalidation with existing Android sync; preserve full reads on conflicts.
- [ ] Run JVM tests and Android CI, verify diff, document scope and rollout.
- [ ] Deploy backward-compatible Edge change and publish Android source after checks.
