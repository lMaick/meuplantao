# Project: MeuPlantão UI/UX Production Redesign

## Architecture
MeuPlantão is a Next.js 16 (App Router) + React 19 web application tailored for medical professionals to manage on-call shifts, financial receivables, and payment tracking.
- **Frontend Stack**: Next.js App Router, Tailwind CSS v4, shadcn/ui ("base-nova"), @base-ui/react, Lucide React icons.
- **Backend & Auth**: Supabase (@supabase/ssr), PostgreSQL with RLS, SECURITY DEFINER atomic RPCs (`save_shift_with_obligation`, `register_payment`).
- **Data Access Layer (DAL)**: Strictly encapsulated in `src/lib/<modulo>/` functions with typed returns.
- **Test Runner**: Node native test runner (`node --experimental-strip-types --test tests/*.test.mjs`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Mobile-First App Shell & Navigation | Ergonomic bottom bar, safe-area padding (`pb-safe`), top header with drawer, z-index hierarchy (modals z-50, bottom bar z-30, header z-20) | M1 | ORIGINAL_REQUEST §R1, Survey 1 |
| 2 | Touch Target Standardization | Ensure all interactive buttons, filter pills, inputs, selects meet or exceed 44x44px | M1 | ORIGINAL_REQUEST §R1, Survey 1 |
| 3 | Design System & UI Primitives | Semantic OKLCH tokens, rich `EmptyState` (icons + CTAs), comprehensive loading skeletons | M1 | ORIGINAL_REQUEST §R2, Survey 1 |
| 4 | Dashboard UI/UX Redesign | Metric cards, alerts banner with semantic tokens, 44px touch targets, rich skeletons, empty state | M2 | ORIGINAL_REQUEST §R2, Survey 1 |
| 5 | Calendar & Shifts Redesign | Mobile-first day agenda + monthly badges, 360px-430px fit, z-50 modal, idempotency & atomic obligation preserved | M2 | ORIGINAL_REQUEST §R1, Survey 1, Survey 2 |
| 6 | Financial & Payments Control Redesign | Totalizer cards, status cues (on-time, upcoming, overdue), 44px filters, quick-action "Receber" modal with balance guard, CSV export | M3 | ORIGINAL_REQUEST §R2, Survey 1, Survey 2 |
| 7 | History View Redesign | Mobile card view (< 640px) eliminating horizontal overflow on 360-430px, desktop table, touch filters, CSV export | M3 | ORIGINAL_REQUEST §R1, Survey 1 |
| 8 | Supporting Views Polish | Polish `/locais`, `/contatos`, `/alertas` with 44px targets, z-50 modals, skeletons, empty states | M3 | ORIGINAL_REQUEST §R2, Survey 1 |
| 9 | Opaque-Box E2E Test Suite | Tiers 1-4 (Category-Partition, BVA, Pairwise, Real-World Workload) validating UI/UX requirements | E2E | ORIGINAL_REQUEST §Acceptance Criteria, Survey 3 |
| 10 | Final Verification & Adversarial Coverage | Pass 100% E2E tests + npm test + npm run lint + npm run build, Tier 5 adversarial hardening | M4 | ORIGINAL_REQUEST §Verification, Survey 3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Suite Track | Design and implement opaque-box E2E tests (Tiers 1-4) in `tests/e2e-*.test.mjs`, publish `TEST_INFRA.md` and `TEST_READY.md` | none | DONE |
| M1 | Foundations & Design System | Upgrade buttons & inputs (>=44px), AppShell navigation & z-indices, skeletons, rich EmptyState, semantic theme tokens | none | DONE |
| M2 | Core Operational Views | Dashboard & Calendar/Shifts redesign with responsive day-agenda, z-50 modal, idempotency AST test preservation | M1 | DONE |
| M3 | Financial & History Views | Payments/Receivables, History responsive cards (<640px), Locais/Contatos/Alertas polish | M1 | DONE |
| M4 | Final Milestone & Hardening | Phase 1: Pass 100% E2E tests (Tiers 1-4). Phase 2: Adversarial coverage hardening (Tier 5), lint, build verification | M2, M3, E2E | DONE |

## Interface Contracts

### UI Primitives Contract (M1 -> M2, M3)
- `Button`: default size must have `min-h-[44px]` (or `h-11`) with minimum 44px touch target on mobile.
- `Input`, `Select`: `h-11` (44px) minimum height with focus ring and comfortable tap area.
- `EmptyState`: Component accepting `icon: LucideIcon`, `title: string`, `description: string`, `action?: React.ReactNode`.
- `Skeleton`: Standardized skeleton blocks (`CardSkeleton`, `TableSkeleton`, `MetricsSkeleton`).

### Shift Calendar & Domain Contract (M2 -> Tests & DAL)
- File `src/components/shifts/shift-calendar.tsx` MUST retain:
  - `saveShiftWithObligation` import and usage
  - `ShiftCreationIntent` import and usage
  - `idempotency_key` pass-through
  - MUST NOT import or invoke `createShift(` or `updateShift(`
- Modal must use `z-50` to render above AppShell bottom nav (`z-30`).

### Financial Calculations Contract (M2, M3 -> AGENTS.md Invariants)
- `saldo` = `valor_devido - soma dos pagamentos registrados`. Never store or hardcode static status.
- `isOverdue` = `data_prevista < today` in `America/Bahia` timezone.
- Payments: `valor <= saldo`, strictly positive. Register via `createPayment` (invoking `register_payment` RPC).
- Cancellation: via `cancelPayment` / `removePayment` (sets `status: "cancelado"`). No physical deletion.

## Code Layout
- `src/components/ui/`: Shared primitives (`button.tsx`, `primitives.tsx`, `app-shell.tsx`, `stat-card.tsx`, `card.tsx`, `skeletons.tsx`)
- `src/components/dashboard/`: Dashboard view and alerts banner (`dashboard.tsx`, `dashboard-alerts.tsx`)
- `src/components/shifts/`: Shift management (`shift-calendar.tsx`)
- `src/components/payments/`: Financial receivables view (`payments-page.tsx`, `finance-filters.tsx`)
- `src/app/historico/`: History page and view (`page.tsx`, `history-view.tsx`)
- `src/app/calendario/`: Calendar route (`page.tsx`, `plantao/[id]/page.tsx`)
- `src/lib/<modulo>/`: Pure DAL functions and domain logic (UNCHANGED)
- `tests/`: Automated test suites (`node --experimental-strip-types --test tests/*.test.mjs`)
