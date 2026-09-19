# Test Infrastructure & Specification Guide (TEST_INFRA.md)

## 1. Overview & Architectural Principles

The testing infrastructure of **MeuPlantão** provides fast, deterministic, zero-dependency automated verification designed specifically for medical on-call scheduling and receivables tracking.

The test architecture is founded on the following non-negotiable principles:
1. **Opaque-Box Specification Conformance**: Tests evaluate observable behavior, UI/UX ergonomic contracts, responsive layout modes, and domain invariants derived directly from authoritative requirements (`ORIGINAL_REQUEST.md`, `PROJECT.md`, `AGENTS.md`).
2. **Zero-Flake Native Execution**: Built using the native Node.js test runner (`node:test`, `node:assert/strict`) with `--experimental-strip-types`, avoiding bloated intermediate build steps, unneeded compilation artifacts, or flaky browser daemon lifecycles during CI unit/E2E verification.
3. **Strict Invariant Guards**: Financial balances and status are strictly computed from actual shifts and registered payments (`saldo = valor_devido - sum(payments)`). Multi-tenant isolation (`auth.uid()`) is enforced at all boundary layers.

---

## 2. Test Execution & Toolchain

### 2.1 Core Commands

| Command | Purpose | Target / Files | Execution Time |
| :--- | :--- | :--- | :--- |
| `npm test` | Complete offline test suite (Unit + 4-Tier E2E) | `tests/*.test.mjs` | ~3.2s |
| `node --experimental-strip-types --test tests/e2e-ui-redesign.test.mjs` | Focused 4-Tier UI/UX E2E redesign suite | `tests/e2e-ui-redesign.test.mjs` | ~0.8s |
| `npm run lint` | ESLint Flat Config verification | `src/`, `tests/` | ~3.5s |
| `npx tsc --noEmit` | Strict TypeScript type checking | `src/` | ~2.5s |
| `npm run build` | Next.js production build compilation | App Router routes | ~8.0s |
| `npm run test:real` | Live Supabase/PostgreSQL RLS & concurrency test | `tests/financial-real-e2e.real.mjs` | Requires Docker daemon |

### 2.2 Continuous Integration Pipeline (`.github/workflows/ci.yml`)
CI runs on every push and PR under Node 22 (`ubuntu-latest`):
1. `npm ci`
2. `npm test` (Enforces 100% pass rate across all 216 tests)
3. `npm run lint` (0 errors tolerance)
4. `npx tsc --noEmit` (Strict typing)
5. `npm run build` (Production artifact generation)

---

## 3. Directory Layout & Test Artifacts

```
tests/
├── helpers/
│   └── e2e-harness.mjs                # Reusable domain, layout, and ergonomic oracles
├── e2e-ui-redesign.test.mjs           # 4-Tier Opaque-Box E2E Test Suite (132 tests)
├── atomic-shift-obligation.test.mjs   # RPC contracts and migration integrity (3 tests)
├── auth-callback.test.mjs             # Next.js OAuth code exchange & cookie persistence (4 tests)
├── auth-redirect.test.mjs             # Open redirect mitigation & safeNext (4 tests)
├── dashboard-alerts.test.mjs          # Timezone, delta math & alert suppression (15 tests)
├── extrato-csv.test.mjs               # RFC 4180 CSV export with UTF-8 BOM (6 tests)
├── finance-filters.test.mjs           # Period and place filtering without mutation (7 tests)
├── financial-integrity.test.mjs       # Pure domain simulation of financial invariants (18 tests)
├── financial-obligations.test.mjs     # Derived balances and Bahia due date rules (2 tests)
├── jwt-recovery-policy.test.mjs       # Session cleanup error classification (3 tests)
├── jwt-recovery.test.mjs              # DAL session recovery interception (4 tests)
├── logout.test.mjs                    # Supabase signOut redirect safety (4 tests)
├── production-hardening.test.mjs      # Middleware matcher validation (1 test)
├── shift-calendar-idempotency.test.mjs# UUID v4 intent token lifecycle (6 tests)
├── supabase-config.test.mjs           # Fail-closed config & RPC assertions (5 tests)
├── financial-real-e2e.real.mjs        # Live PostgreSQL integration (opt-in)
└── financial-migration-upgrade-real.sh# Live migration upgrade validator
```

---

## 4. The 4-Tier Opaque-Box E2E Testing Framework

The E2E testing harness in `tests/e2e-ui-redesign.test.mjs` evaluates the UI/UX redesign across 4 formal testing tiers:

```
+-------------------------------------------------------------------------+
|                  TIER 1: CATEGORY-PARTITION TESTING                     |
|  50 tests: >=5 tests per feature across all 10 features in PROJECT.md   |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
|                  TIER 2: BOUNDARY VALUE ANALYSIS (BVA)                  |
|  50 tests: >=5 tests per feature at critical boundaries & edge cases    |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
|                  TIER 3: PAIRWISE COMBINATIONS MATRIX                   |
|  24 tests: Orthogonal interaction matrix (Screens, Viewports, States)   |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
|                TIER 4: REAL-WORLD WORKLOAD TESTING                      |
|  8 tests: End-to-end simulations of physician on-call user journeys     |
+-------------------------------------------------------------------------+
```

### 4.1 Tier 1: Category-Partition Testing (50 tests)
Equivalence partitions verify normal operation for each feature:
- **Feature 1 (App Shell & Navigation)**: Bottom bar navigation, "+ Plantão" quick CTA, drawer menu toggle, z-index hierarchy (`z-50 > z-30 > z-20`), safe-area padding (`pb-safe`).
- **Feature 2 (Touch Targets)**: Primary buttons >= 44x44px, bottom nav thumb targets, inputs & selects (h-11), filter pills, dialog action buttons.
- **Feature 3 (Design System Primitives)**: OKLCH color token roles, rich `EmptyState` contract (icon, title, description, CTA), informational empty state, skeleton suite (`CardSkeleton`, `TableSkeleton`, `MetricsSkeleton`), badge variants.
- **Feature 4 (Dashboard Redesign)**: Dynamic metric cards, urgent overdue alert banner (`hasAlerts: true`), preventive 7-day upcoming alert banner, empty portfolio state, loading skeletons.
- **Feature 5 (Calendar & Shifts)**: Mobile agenda vs table layout, shift statuses (`agendado`, `realizado`, `cancelado`), idempotency token generation & retry stability, z-50 modal elevation, atomic obligation validation.
- **Feature 6 (Financial & Payments)**: Dynamic status cues (`Pendente`, `Parcial`, `Recebido`, `Atrasado`), Bahia current month normalization, quick-action "Receber" modal balance guard, balance reduction upon payment, RFC 4180 CSV export.
- **Feature 7 (History View)**: Mobile cards (< 640px) eliminating horizontal overflow, desktop table (>= 640px), multi-field filtering without data mutation, empty search state, Brazilian currency & date formatting.
- **Feature 8 (Supporting Views)**: `/locais` 44px targets & empty state, `/contatos` card structure & badges, `/alertas` overdue vs upcoming grouping, skeleton card loading, accessible confirmation dialogs.
- **Feature 9 (E2E Test Architecture)**: Native Node.js execution, deterministic assertions, specification derivation, clear error diagnostics, sub-50ms execution speed.
- **Feature 10 (Verification & Adversarial)**: Accented and special character escaping, zero/negative payment rejection, strict multi-tenant user isolation, idempotent retry stability, logical cancellation immutability.

### 4.2 Tier 2: Boundary Value Analysis (50 tests)
Evaluates critical threshold boundaries:
- **Navigation & Viewport Boundaries**: 359px (overflow) vs 360px (zero overflow), 1023px (mobile nav) vs 1024px (desktop sidebar), scroll threshold 0px vs 1px (`backdrop-blur`), safe area inset 0px vs 34px, drawer backdrop coordinates.
- **Touch Target Ergonomic Boundaries**: 43px (fails) vs 44px (passes), 44px (minimum) vs 48px (optimal), 28px (legacy sm) vs 44px (pill target), 43px vs 44px calendar day columns, icon touch expansion.
- **Design System Boundaries**: Empty whitespace title vs 1-char title, skeleton `aria-busy="true"` accessibility, text truncation at 60 vs 61 characters, badge counters 99 vs 99+, OKLCH contrast ratio delta >= 0.6.
- **Dashboard Boundaries**: 0 shifts vs 1 shift, due today (on time) vs due yesterday (overdue), today + 7 days vs today + 8 days preventive window, balance 0 vs 0.01 alert trigger, R$ 0,00 vs R$ 999.999.999,99 currency formatting.
- **Calendar Boundaries**: 23:59 last day of month vs 00:00 next month, leap year Feb 28 vs 29, 0-minute duration rejected vs 24h accepted, shift value 0.00 rejected vs 0.01 accepted, UUID v4 syntax validation.
- **Financial Receivables Boundaries**: Payment 0.00 rejected vs 0.01 accepted, partial payment `saldo - 0.01`, exact settlement `saldo`, overpayment `saldo + 0.01` rejected (constraint `23514`), 23:59:59 due date boundary in Bahia timezone.
- **History Boundaries**: Viewport 639px (cards) vs 640px (table), 0 filter matches empty state, 10 vs 11 items pagination threshold, 0 rows (headers only) vs 1000 rows CSV streaming, single-day date range slicing.
- **Supporting Views Boundaries**: Name length 1 vs 100 characters, phone number 10 vs 11 digits, alert badge 0 vs 1, modal backdrop click dismiss vs modal body click retain, dialog confirm vs cancel.
- **Test Harness Robustness Boundaries**: Null and undefined input handling, float rounding (`0.1 + 0.2 = 0.30`), deep state comparison, empty collection safety, async timeout bounds.
- **Adversarial Hardening Boundaries**: SQL injection strings treated as plain text, XSS injection strings escaped, concurrent payment race rejecting overdraw, status locking preventing demotion of paid shifts, 3-decimal float rounding.

### 4.3 Tier 3: Pairwise Combinations Matrix (24 tests)
An orthogonal interaction matrix combining:
- **Screens**: `[Dashboard, Calendar, Payments, History]` (4)
- **Viewports**: `[360px (Mobile Narrow), 390px (Mobile Standard), 430px (Mobile Large), 1280px (Desktop)]` (4)
- **Financial States**: `[Pendente, Parcial, Quitado, Atrasado]` (4)
- **Loading States**: `[Loading Skeleton, Populated, Empty]` (3)
- **Responsible Types**: `[Local, Contato]` (2)

Every scenario verifies responsive layout mode, >=44px touch target compliance, correct visual state presentation, and status cue accuracy.

### 4.4 Tier 4: Real-World Workload Testing (8 tests)
End-to-end user journeys simulating real physician operations:
1. **Journey 1**: Mobile quick shift entry between rounds on iPhone 13 (390px) with UUID v4 idempotency token, atomic obligation creation, and agenda update.
2. **Journey 2**: Partial payment receipt notification (R$ 600 of R$ 1.500) and cross-screen reconciliation updating `/pagamentos` and `/dashboard` metrics.
3. **Journey 3**: Full payment settlement (remaining R$ 900): obligation reaches R$ 0,00, status transitions to "Recebido", and overdue alert indicators clear.
4. **Journey 4**: Monthly audit and RFC 4180 CSV export with UTF-8 BOM, semicolon delimiter, 10 columns, Brazilian currency/date formatting, and derived status.
5. **Journey 5**: Surgical emergency session timeout: physician returns after 4 hours, JWT expired (`bad_jwt`/`PGRST301`), DAL clears session and safely redirects to `/login?reason=session-expired&next=/calendario`.
6. **Journey 6**: Destructive mutation guard: attempted cancellation of a shift with registered payments is blocked by financial integrity invariants.
7. **Journey 7**: Multi-hospital roster navigation: place filtering isolates hospital records without leaking totals.
8. **Journey 8**: High-volume annual roster stress simulation: evaluates 60 shifts across 12 months with sub-100ms execution time and zero balance drift.

---

## 5. Specification Oracles (`tests/helpers/e2e-harness.mjs`)

The testing suite relies on 4 centralized oracles:
- `ErgonomicsOracle`: Evaluates touch targets (>= 44x44px), viewport overflow detection (360px-430px), z-index layering (`50 > 30 > 20`), and responsive display mode breakpoints (640px, 1024px).
- `DesignSystemOracle`: Validates `EmptyState` and `Skeleton` component contracts and maps financial metrics to semantic status cues.
- `FinancialDomainOracle`: Strict mathematical balance computation (`saldo = valor_devido - sum(payments)`), payment ceiling validation, status transition locks, and Bahia timezone overdue evaluation.
- `UserIsolationOracle`: Validates multi-tenant row ownership and ensures cross-user queries are completely blocked.
