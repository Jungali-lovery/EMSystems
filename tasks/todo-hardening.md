# EMSystems — Hardening implementation plan (2026-10-25)

## Goal
Move customer-facing authentication, authorization and order writes behind a persistent server boundary; make checkout deterministic and idempotent; complete production/deployment readiness without pretending payment credentials or live DNS exist.

## Work slices
- [ ] Slice 1 — API server and database: Node HTTP API, SQLite-backed shared application state, opaque HttpOnly session cookies, request-size limits, origin validation, auth throttling, structured errors and security headers.
- [ ] Slice 2 — API client migration: route React data requests through /api/app, move backup/restore/diagnostics/reset to server endpoints, proxy API in Vite and start the API process in development.
- [ ] Slice 3 — Atomic checkout: server serializes state-changing operations inside SQLite transactions; client idempotency key; DB idempotency ledger; validates canonical server-side amounts/stock; tests race/replay behaviour.
- [ ] Slice 4 — Payment hardening: validate payment service origin/configuration, signature and amount checks, request limits and provider status; keep sandbox-only until merchant credentials and public HTTPS callback are verified.
- [ ] Slice 5 — Storefront conversion and trust: price/brand filters, sorting and pagination, true review schema/endpoints (only verified delivered purchases), featured section, product metadata/structured data, product policies/contact/relevant items.
- [ ] Slice 6 — UX and runtime tests: remove item control, responsive search/menu, accessible zoom/share, robust API error flows, HTTP/API end-to-end test suite.
- [ ] Slice 7 — Deployment: Caddy HTTPS reverse-proxy example, environment template, private database/backup path and release runbook.
- [ ] Slice 8 — Verify: unit tests, backend API E2E, production build, npm audit, route smoke tests, and document all blockers.

## Safety constraints
- Never ship credentials in the browser or commit .env.
- No production payment claims while merchant/IPN setup is missing.
- Review import/export and session isolation to avoid cross-user leakage.
- Do not advertise fabricated customer reviews, ratings or sales figures.
- Preserve current admin demo screens where they do not undermine the server boundary.
- Existing browser localStorage is not silently trusted/imported into the database. Export an existing backup before migration and restore it through the authenticated server-side restore workflow.

## Acceptance
- Existing domain logic regression suite passes.
- Backend persists state across process restarts.
- Staff sessions are HttpOnly-cookie backed and separate per browser.
- Malformed/oversize requests, invalid origins, brute-force login and unauthorized routes fail closed.
- Same checkout idempotency key cannot create duplicate orders and concurrent order placement cannot oversell server stock.
- Production build and API E2E tests pass.
- Deployment notes clearly distinguish deployable code from DNS/domain/merchant tasks that require operator credentials.
