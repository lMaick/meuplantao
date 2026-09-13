/**
 * E2E Testing Harness and Specification Oracles for MeuPlantão UI/UX Redesign
 *
 * Implements opaque-box evaluation rules, layout geometry calculations,
 * design token verifications, financial invariant guarantees, and
 * user workload simulators based strictly on PROJECT.md and ORIGINAL_REQUEST.md.
 */

import { financialAmounts, isOverdue as domainIsOverdue } from "../../src/lib/obligations/financial.ts";
import { computeDashboardAlerts } from "../../src/lib/dashboard/alerts.ts";
import {
  currentMonthValue,
  matchesShift,
  matchesPeriod,
  matchesPlace,
} from "../../src/lib/finance-filters/index.ts";
import {
  buildExtratoCsv,
  situacaoFinanceira,
  escapeCsvCell,
  formatMoeda,
  formatDataBR,
  extratoFilename,
} from "../../src/lib/exports/extrato-csv.ts";
import { ShiftCreationIntent, keyForShiftSave } from "../../src/lib/shifts/idempotency.ts";
import { safeNext, authCallbackUrl } from "../../src/lib/auth/redirect.ts";
import { isInvalidJwtError } from "../../src/lib/auth/jwt-recovery.ts";

/**
 * Tier 1 & Tier 2: Ergonomics, Viewport, and Touch Target Oracle
 */
export const ErgonomicsOracle = {
  MIN_TOUCH_TARGET_PX: 44,
  OPTIMAL_TOUCH_TARGET_PX: 48,
  MIN_MOBILE_VIEWPORT_PX: 360,
  MAX_MOBILE_VIEWPORT_PX: 430,
  DESKTOP_BREAKPOINT_PX: 1024,
  TABLE_BREAKPOINT_PX: 640,

  /**
   * Evaluates if an interactive element meets the touch target specification (>= 44x44px).
   */
  evaluateTouchTarget(width, height, elementDescription = "element") {
    const minDim = Math.min(width, height);
    const pass = width >= this.MIN_TOUCH_TARGET_PX && height >= this.MIN_TOUCH_TARGET_PX;
    const isOptimal = width >= this.OPTIMAL_TOUCH_TARGET_PX && height >= this.OPTIMAL_TOUCH_TARGET_PX;
    const deficit = pass ? 0 : this.MIN_TOUCH_TARGET_PX - minDim;
    return {
      pass,
      isOptimal,
      width,
      height,
      deficit,
      elementDescription,
      rule: "Touch targets must meet or exceed 44x44px for mobile ergonomics (PROJECT.md §R1)",
    };
  },

  /**
   * Evaluates viewport horizontal overflow. 360px-430px must render without horizontal scrolling.
   */
  evaluateViewportOverflow(viewportWidth, contentWidth) {
    const isSupportedMobile =
      viewportWidth >= this.MIN_MOBILE_VIEWPORT_PX && viewportWidth <= this.MAX_MOBILE_VIEWPORT_PX;
    const hasHorizontalOverflow = contentWidth > viewportWidth;
    const overflowPx = Math.max(0, contentWidth - viewportWidth);

    return {
      pass: !hasHorizontalOverflow,
      viewportWidth,
      contentWidth,
      overflowPx,
      isSupportedMobile,
      rule: "No horizontal overflow permitted on 360px-430px viewports (ORIGINAL_REQUEST.md §Acceptance Criteria)",
    };
  },

  /**
   * Validates z-index layering hierarchy to prevent bottom nav / modal collisions.
   */
  evaluateZIndexStack({ modalZ, bottomNavZ, headerZ, contentZ = 0 }) {
    // Contract from PROJECT.md: Modals z-50 > Bottom Nav z-30 > Header z-20 > Content z-0
    const modalAboveNav = modalZ > bottomNavZ;
    const navAboveHeader = bottomNavZ > headerZ;
    const headerAboveContent = headerZ > contentZ;
    const isValid = modalAboveNav && navAboveHeader && headerAboveContent;

    return {
      pass: isValid,
      modalZ,
      bottomNavZ,
      headerZ,
      contentZ,
      hierarchy: `${modalZ} > ${bottomNavZ} > ${headerZ} > ${contentZ}`,
      rule: "Modals (z-50) must render strictly above mobile bottom nav (z-30) and header (z-20)",
    };
  },

  /**
   * Determines responsive data display mode based on viewport width.
   */
  resolveResponsiveLayout(viewportWidth) {
    return viewportWidth < this.TABLE_BREAKPOINT_PX ? "mobile-cards" : "desktop-table";
  },

  /**
   * Determines navigation shell layout based on viewport width.
   */
  resolveShellLayout(viewportWidth) {
    return viewportWidth < this.DESKTOP_BREAKPOINT_PX ? "mobile-bottom-nav" : "desktop-sidebar";
  },
};

/**
 * Design System, Primitives, and Visual State Oracle
 */
export const DesignSystemOracle = {
  /**
   * Validates EmptyState primitive interface contract.
   */
  validateEmptyStateContract({ icon, title, description, action = null }) {
    const hasIcon = Boolean(icon);
    const hasTitle = typeof title === "string" && title.trim().length > 0;
    const hasDescription = typeof description === "string" && description.trim().length > 0;
    const hasAction = action !== null && action !== undefined;

    return {
      pass: hasIcon && hasTitle && hasDescription,
      hasIcon,
      hasTitle,
      hasDescription,
      hasAction,
      contract: "EmptyState accepts { icon: LucideIcon, title: string, description: string, action?: ReactNode }",
    };
  },

  /**
   * Validates Skeleton primitive contract.
   */
  validateSkeletonContract({ type, ariaBusy, animated = true }) {
    const validTypes = ["card", "table", "metrics", "text", "badge"];
    const isValidType = validTypes.includes(type);
    const hasAccessibility = ariaBusy === true || ariaBusy === "true";

    return {
      pass: isValidType && hasAccessibility && animated,
      type,
      ariaBusy,
      animated,
      contract: "Skeletons must specify valid layout block type and aria-busy='true'",
    };
  },

  /**
   * Maps financial state to semantic status cues (color tone, label, badge).
   */
  deriveStatusCue({ saldo, valorDevido, isOverdue }) {
    const expected = Number(valorDevido || 0);
    const balance = Number(saldo || 0);
    const received = Math.max(0, expected - balance);

    if (balance <= 0 && received > 0) {
      return {
        key: "recebido",
        label: "Recebido",
        tone: "success",
        badgeVariant: "default",
        description: "Valor integralmente quitado",
      };
    }
    if (balance > 0 && isOverdue) {
      return {
        key: "atrasado",
        label: "Atrasado",
        tone: "destructive",
        badgeVariant: "destructive",
        description: "Vencimento ultrapassado com saldo em aberto",
      };
    }
    if (balance > 0 && received > 0) {
      return {
        key: "parcial",
        label: "Parcial",
        tone: "warning",
        badgeVariant: "secondary",
        description: "Pagamento parcial registrado com saldo restante",
      };
    }
    return {
      key: "pendente",
      label: "Pendente",
      tone: "neutral",
      badgeVariant: "outline",
      description: "Aguardando pagamento dentro do prazo previsto",
    };
  },
};

/**
 * Domain & Financial Calculations Oracle
 */
export const FinancialDomainOracle = {
  /**
   * Computes obligation saldo and received strictly from payments array.
   */
  computeBalance(valorDevido, payments = []) {
    const expected = Number(valorDevido || 0);
    const activePayments = (payments || []).filter((p) => p && p.status === "registrado");
    const sumPaid = activePayments.reduce((acc, p) => acc + Number(p.valor || 0), 0);
    const roundedPaid = Math.round(sumPaid * 100) / 100;
    const roundedExpected = Math.round(expected * 100) / 100;
    const balance = Math.max(0, Math.round((roundedExpected - roundedPaid) * 100) / 100);

    return {
      expected: roundedExpected,
      received: roundedPaid,
      balance,
      activePaymentCount: activePayments.length,
    };
  },

  /**
   * Validates a proposed payment amount against remaining balance.
   */
  validatePaymentRegistration({ currentBalance, paymentAmount }) {
    const balance = Math.round(Number(currentBalance || 0) * 100) / 100;
    const amount = Math.round(Number(paymentAmount || 0) * 100) / 100;

    if (amount <= 0) {
      return {
        valid: false,
        error: "Valor do pagamento deve ser estritamente positivo",
        errorCode: "INVALID_AMOUNT",
      };
    }
    if (amount > balance) {
      return {
        valid: false,
        error: "Valor do pagamento não pode exceder o saldo devedor",
        errorCode: "23514", // PostgreSQL check constraint code
      };
    }
    const newBalance = Math.round((balance - amount) * 100) / 100;
    return {
      valid: true,
      newBalance,
      isFullSettlement: newBalance === 0,
    };
  },

  /**
   * Checks status transition locking rule when registered payments exist.
   */
  validateStatusTransition(currentStatus, targetStatus, registeredPaymentsCount) {
    if (currentStatus === "realizado" && registeredPaymentsCount > 0) {
      if (targetStatus === "agendado" || targetStatus === "cancelado") {
        return {
          allowed: false,
          error: "Não é permitido alterar ou cancelar plantão com pagamentos registrados",
        };
      }
    }
    return { allowed: true };
  },

  /**
   * Overdue calculation matching America/Bahia timezone rule.
   */
  isOverdue(dataPrevista, referenceDate = new Date()) {
    return domainIsOverdue(dataPrevista, referenceDate);
  },
};

/**
 * Multi-Tenant & User Isolation Oracle
 */
export const UserIsolationOracle = {
  /**
   * Validates that access to an entity strictly matches authenticated user ID.
   */
  assertOwnership(authenticatedUserId, entity) {
    if (!authenticatedUserId) {
      throw new Error("UNAUTHENTICATED: auth.uid() is null");
    }
    if (!entity || entity.user_id !== authenticatedUserId) {
      throw new Error("FORBIDDEN: Access to resource owned by another user is strictly blocked by RLS");
    }
    return true;
  },

  /**
   * Filters an array of entities strictly scoped to the authenticated user.
   */
  filterUserScope(authenticatedUserId, entities = []) {
    if (!authenticatedUserId) return [];
    return entities.filter((e) => e.user_id === authenticatedUserId);
  },
};

/**
 * Re-export verified domain modules for unified test usage
 */
export {
  financialAmounts,
  domainIsOverdue,
  computeDashboardAlerts,
  currentMonthValue,
  matchesShift,
  matchesPeriod,
  matchesPlace,
  buildExtratoCsv,
  situacaoFinanceira,
  escapeCsvCell,
  formatMoeda,
  formatDataBR,
  extratoFilename,
  ShiftCreationIntent,
  keyForShiftSave,
  safeNext,
  authCallbackUrl,
  isInvalidJwtError,
};
