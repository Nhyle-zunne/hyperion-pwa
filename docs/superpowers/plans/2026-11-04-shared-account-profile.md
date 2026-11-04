# Shared account profile implementation plan

**Goal:** Keep the existing profile sidebar visible on Checkout and Orders, as on Bond Store and My licenses.

**Architecture:** Reuse AccountScreen as a layout when children are supplied. Keep profile/session controls unchanged. In layout mode, the child page owns cart persistence, entitlement reads, and payment verification. Key route layouts so returning to the store reloads the current saved cart. Reuse the existing desktop sidebar and mobile collapse behavior.

**Scope:** AccountScreen, the three checkout/orders routes in App, an isolated browser regression, its existing fixture runner/config, and CI. No backend, licensing, payment-handler, or production-data changes.

**Spec:** User browser comments requesting the same left profile panel on /checkout and /orders.

## Task 1: Shared layout and regression

- [x] Add an isolated browser fixture using synthetic account data and blocked external requests.
- [x] Verify the regression fails because checkout/orders do not render the shared profile layout.
- [x] Add optional child content to AccountScreen; prevent its store-only effects from running in layout mode.
- [x] Wrap checkout, basket alias, and order routes with keyed AccountScreen layouts. Fit nested screens to the content column and stack checkout columns when space is limited.
- [x] Verify profile display/edit/cancel, desktop and mobile placement, cart preservation, route navigation, and absence of duplicate commerce reads.
- [ ] Run TypeScript/build checks and existing CI regressions; independently review the final branch.

## Review focus

Preserve the saved cart during child mounting and return navigation. Keep the existing payment verification and licensing guards owned by each page. Preserve profile editing, sign-out, and explicit deletion confirmation. Keep the sidebar left at desktop/tablet widths and above content on mobile, without horizontal overflow.

## Execution record

Local validation uses a source snapshot retrieved at the main commit through the GitHub connector because local Git authentication is unavailable. Changes are published through an isolated GitHub branch for review.

The browser regression first failed waiting for Checkout to render through AccountScreen. After implementation it passed at 1531px, 870px, and 390px, including profile edit/cancel, mobile expand/collapse, BUY NOW selection, navigation, and cart preservation. Screenshots were inspected. `tsc -b`, the Worker TypeScript check, and `npm run test:security` passed. Initial security/Worker checks reported missing files in the partial local snapshot; retrieving those unchanged dependencies resolved the setup errors. Package downloads required a retry after an npm registry idle timeout. No dependency files changed.
