#!/usr/bin/env node
/**
 * MeuPlantao — Production Gate: RLS & Grants Invariants (READ-ONLY)
 *
 * Verifica invariantes críticas de segurança diretamente no catálogo
 * PostgreSQL (pg_catalog / information_schema), SEM nenhuma mutação.
 *
 * Invariantes checadas (ver docs/security-invariants.md):
 *  - public.shifts: RLS habilitada; authenticated SEM INSERT EFETIVO;
 *    authenticated SEM UPDATE EFETIVO (tabela + colunas); SELECT próprio
 *    preservado (grant + policy shifts_select_own com auth.uid()).
 *  - RPC save_shift_with_obligation: EXECUTE para authenticated;
 *    SECURITY DEFINER; SEM EXECUTE para anon/public.
 *  - public.subscription_payments: RLS habilitada; authenticated SEM
 *    escrita EFETIVA (INSERT/UPDATE/DELETE, tabela + colunas); SELECT
 *    próprio isolado por auth.uid().
 *  - public.payments: RLS habilitada; SEM policy de DELETE; SELECT próprio
 *    isolado; UPDATE próprio restrito a cancelamento lógico.
 *  - public.obligations: RLS habilitada; authenticated SEM UPDATE EFETIVO
 *    na coluna financeira valor_devido.
 *
 * "EFETIVO" = has_table_privilege / has_column_privilege para o papel
 * authenticated, que computam grants diretos + via PUBLIC + herança de
 * roles. Checar apenas role_table_grants com grantee = 'authenticated'
 * gera falso negativo quando o drift usa GRANT ... TO PUBLIC (MAI-135).
 *
 * Qualquer divergência => gate falha (fail-closed).
 */

import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client: PgClient } = pg;

function redactSecretsLocal(text, extraSecrets = []) {
  if (typeof text !== "string") return String(text ?? "");
  let redacted = text;
  for (const s of extraSecrets) {
    if (s && typeof s === "string" && s.trim().length >= 4) {
      redacted = redacted.replaceAll(s.trim(), "[REDACTED]");
    }
  }
  redacted = redacted.replace(/:\/\/([^:@]+):([^@]+)@/g, "://$1:[REDACTED]@");
  return redacted;
}

function getPgClientConfigLocal(databaseUrl) {
  const isLocal =
    !databaseUrl ||
    databaseUrl.includes("localhost") ||
    databaseUrl.includes("127.0.0.1") ||
    databaseUrl.includes("@localhost") ||
    databaseUrl.includes("@127.0.0.1");
  const config = { connectionString: databaseUrl, connectionTimeoutMillis: 10000 };
  if (!isLocal) config.ssl = { rejectUnauthorized: false };
  return config;
}

export const SECURITY_TABLES = [
  "shifts",
  "subscription_payments",
  "payments",
  "obligations",
];

export const SECURITY_FUNCTIONS = [
  "save_shift_with_obligation",
  "register_payment",
  "process_mercadopago_subscription_payment",
  "reconcile_mercadopago_reversal",
  "has_active_entitlement",
];

/**
 * Safety guard do teste REAL (fail-closed ANTES de qualquer conexão/mutação).
 *
 * Somente hosts locais explícitos são aceitos — nunca um banco remoto/
 * produção, mesmo que apontado por variável de ambiente. Não existe flag
 * que libere host remoto: a lista é fechada por construção.
 */
export const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function getDatabaseHostname(databaseUrl) {
  const parsed = new URL(String(databaseUrl || "").trim());
  return (parsed.hostname || "").toLowerCase();
}

export function assertLocalDatabaseUrl(databaseUrl) {
  let hostname = "";
  try {
    hostname = getDatabaseHostname(databaseUrl);
  } catch {
    hostname = "";
  }
  if (!LOCAL_DB_HOSTS.has(hostname)) {
    // Mensagem sanitizada: expõe apenas o hostname, nunca userinfo/senha.
    throw new Error(
      `[security-real] FAIL-CLOSED: host '${hostname || "(ausente)"}' não é local explícito; ` +
        "recusando qualquer conexão/mutação. Hosts permitidos: 127.0.0.1, localhost, ::1.",
    );
  }
  return hostname;
}

/**
 * Normalização canônica de expressões de policy (USING / WITH CHECK).
 *
 * Substring (`includes("auth.uid()")`) aceita policy enfraquecida como
 * `auth.uid() = user_id OR true`. A comparação canônica reduz a expressão a
 * forma exata (minúsculas, sem espaços/parênteses, `(select auth.uid())`
 * colapsado para `auth.uid()`) e exige IGUALDADE com o esperado — qualquer
 * `OR true` ou termo extra reprova.
 */
export function canonicalPolicyExpr(expr) {
  let s = String(expr || "").toLowerCase();
  // Colapsa o subselect de auth.uid() com/sem alias injetado pelo deparser
  // do PG: (select auth.uid() [as uid]) -> auth.uid
  s = s.replace(/\(\s*select\s+auth\.uid\(\)(?:\s+as\s+\w+)?\s*\)/g, "auth.uid");
  s = s.replace(/\s+/g, "");
  // Remove casts de tipo (::text, ::"char", ...) preservando o literal.
  s = s.replace(/::[a-z_"\[\]]+/g, "");
  s = s.replace(/[()]/g, "");
  return s;
}

export const EXPECTED_POLICY_EXPRS = {
  selectOwnQual: "auth.uid=user_id",
  paymentsUpdateWithCheck: "auth.uid=user_idandstatus='cancelado'",
};

/**
 * Queries READ-ONLY (somente SELECT em pg_catalog / information_schema /
 * pg_policies). Nenhuma mutação é executada por este verificador.
 */
export const SECURITY_CATALOG_QUERIES = {
  tablesRls: `
    select c.relname as tablename,
           c.relrowsecurity as rls_enabled,
           c.relforcerowsecurity as force_rls
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname = any($1);`,
  tableGrants: `
    select table_name as tablename, grantee, privilege_type as privilege
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = any($1)
       and grantee in ('authenticated', 'anon', 'public', 'service_role');`,
  columnGrants: `
    select table_name as tablename, column_name, grantee, privilege_type as privilege
      from information_schema.role_column_grants
     where table_schema = 'public'
       and table_name = any($1)
       and grantee in ('authenticated', 'anon', 'public');`,
  policies: `
    select tablename, policyname, roles::text as roles, cmd,
           coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
      from pg_policies
     where schemaname = 'public'
       and tablename = any($1);`,
  functions: `
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args,
           p.prosecdef as secdef,
           pg_get_userbyid(p.proowner) as owner,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as exec_authenticated,
           has_function_privilege('anon', p.oid, 'EXECUTE') as exec_anon,
           has_function_privilege('public', p.oid, 'EXECUTE') as exec_public
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any($1);`,
  effectiveTablePrivs: `
    select t.tablename, p.privilege,
           has_table_privilege('authenticated', ('public.' || t.tablename)::regclass, p.privilege) as has_priv
      from (select unnest($1::text[]) as tablename) t
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(privilege)
     where to_regclass('public.' || t.tablename) is not null;`,
  effectiveColumnPrivs: `
    select c.table_name as tablename, c.column_name, p.privilege,
           has_column_privilege('authenticated', ('public.' || c.table_name)::regclass, c.column_name, p.privilege) as has_priv
      from information_schema.columns c
     cross join (values ('INSERT'), ('UPDATE')) p(privilege)
     where c.table_schema = 'public'
       and c.table_name = any($1);`,
};

export const SECURITY_STATUS = {
  PASS: "PASS",
  FAIL: "FAIL",
};

function hasTableGrant(catalog, table, grantee, privilege) {
  return (catalog.tableGrants || []).some(
    (g) =>
      g.tablename === table &&
      g.grantee === grantee &&
      String(g.privilege).toUpperCase() === privilege,
  );
}

function hasColumnGrant(catalog, table, grantee, privilege, column = null) {
  return (catalog.columnGrants || []).some(
    (g) =>
      g.tablename === table &&
      g.grantee === grantee &&
      String(g.privilege).toUpperCase() === privilege &&
      (column ? g.column_name === column : true),
  );
}

function effectiveTablePriv(catalog, table, privilege) {
  return (catalog.effectiveTablePrivs || []).some(
    (e) =>
      e.tablename === table &&
      String(e.privilege).toUpperCase() === privilege &&
      e.has_priv === true,
  );
}

function effectiveColumnPriv(catalog, table, privilege, column = null) {
  return (catalog.effectiveColumnPrivs || []).some(
    (e) =>
      e.tablename === table &&
      String(e.privilege).toUpperCase() === privilege &&
      e.has_priv === true &&
      (column ? e.column_name === column : true),
  );
}

function findPolicy(catalog, table, name) {
  return (catalog.policies || []).find(
    (p) => p.tablename === table && p.policyname === name,
  );
}

function tableRls(catalog, table) {
  return (catalog.tables || []).find((t) => t.tablename === table);
}

/**
 * Avaliador puro: recebe um catálogo (real ou fixture/mock) e retorna
 * o veredito de cada invariante. Não toca no banco.
 */
export function evaluateSecurityInvariants(catalog = {}) {
  const checks = [];
  const fail = (id, description, details = "") => {
    checks.push({ id, description, status: SECURITY_STATUS.FAIL, details });
  };
  const pass = (id, description, details = "") => {
    checks.push({ id, description, status: SECURITY_STATUS.PASS, details });
  };

  // --- public.shifts ---
  const shiftsRls = tableRls(catalog, "shifts");
  if (shiftsRls?.rls_enabled === true) {
    pass("shifts.rls_enabled", "public.shifts possui RLS habilitada");
  } else {
    fail(
      "shifts.rls_enabled",
      "public.shifts possui RLS habilitada",
      "pg_class.relrowsecurity = false ou tabela ausente no catálogo",
    );
  }

  const shiftsNominalInsert = hasTableGrant(catalog, "shifts", "authenticated", "INSERT");
  const shiftsEffectiveInsert =
    effectiveTablePriv(catalog, "shifts", "INSERT") ||
    effectiveColumnPriv(catalog, "shifts", "INSERT");
  if (!shiftsNominalInsert && !shiftsEffectiveInsert) {
    pass("shifts.no_insert_authenticated", "authenticated SEM INSERT EFETIVO em public.shifts (direto, PUBLIC ou herança)");
  } else {
    fail(
      "shifts.no_insert_authenticated",
      "authenticated SEM INSERT EFETIVO em public.shifts (direto, PUBLIC ou herança)",
      shiftsEffectiveInsert
        ? "has_table/column_privilege(authenticated, INSERT) = true — inclui grants via PUBLIC/herança (drift manual?)"
        : "role_table_grants contém INSERT para authenticated (drift manual?)",
    );
  }

  const shiftsTableUpdate = hasTableGrant(catalog, "shifts", "authenticated", "UPDATE");
  const shiftsColumnUpdate = hasColumnGrant(catalog, "shifts", "authenticated", "UPDATE");
  const shiftsEffectiveUpdate =
    effectiveTablePriv(catalog, "shifts", "UPDATE") ||
    effectiveColumnPriv(catalog, "shifts", "UPDATE");
  if (!shiftsTableUpdate && !shiftsColumnUpdate && !shiftsEffectiveUpdate) {
    pass("shifts.no_update_authenticated", "authenticated SEM UPDATE EFETIVO em public.shifts (tabela + colunas, inclui PUBLIC/herança)");
  } else {
    fail(
      "shifts.no_update_authenticated",
      "authenticated SEM UPDATE EFETIVO em public.shifts (tabela + colunas, inclui PUBLIC/herança)",
      shiftsEffectiveUpdate
        ? "has_table/column_privilege(authenticated, UPDATE) = true — inclui grants via PUBLIC/herança (drift manual?)"
        : shiftsTableUpdate
          ? "role_table_grants contém UPDATE para authenticated"
          : "role_column_grants contém UPDATE de coluna para authenticated",
    );
  }

  const shiftsSelectGrant = hasTableGrant(catalog, "shifts", "authenticated", "SELECT");
  const shiftsSelectPolicy = findPolicy(catalog, "shifts", "shifts_select_own");
  const shiftsSelectIsolated =
    shiftsSelectPolicy &&
    String(shiftsSelectPolicy.roles || "").includes("authenticated") &&
    String(shiftsSelectPolicy.cmd || "").toUpperCase() === "SELECT" &&
    canonicalPolicyExpr(shiftsSelectPolicy.qual) === EXPECTED_POLICY_EXPRS.selectOwnQual;
  if (shiftsSelectGrant && shiftsSelectIsolated) {
    pass("shifts.select_own", "SELECT em public.shifts conforme regra esperada (grant + policy shifts_select_own canônica auth.uid() = user_id)");
  } else {
    const missing = [];
    if (!shiftsSelectGrant) missing.push("grant SELECT ausente");
    if (!shiftsSelectIsolated) missing.push("policy shifts_select_own ausente ou com expressão divergente/enfraquecida");
    fail(
      "shifts.select_own",
      "SELECT em public.shifts conforme regra esperada (grant + policy shifts_select_own canônica auth.uid() = user_id)",
      missing.join("; "),
    );
  }

  const shiftsInsertPolicy = findPolicy(catalog, "shifts", "shifts_insert_own");
  const shiftsUpdatePolicy = findPolicy(catalog, "shifts", "shifts_update_own");
  if (!shiftsInsertPolicy && !shiftsUpdatePolicy) {
    pass("shifts.no_direct_write_policies", "public.shifts SEM policies de escrita direta (shifts_insert_own/shifts_update_own removidas)");
  } else {
    const present = [];
    if (shiftsInsertPolicy) present.push("shifts_insert_own presente");
    if (shiftsUpdatePolicy) present.push("shifts_update_own presente");
    fail(
      "shifts.no_direct_write_policies",
      "public.shifts SEM policies de escrita direta (shifts_insert_own/shifts_update_own removidas)",
      present.join("; "),
    );
  }

  // --- RPC save_shift_with_obligation ---
  const saveShiftFn = (catalog.functions || []).find(
    (f) => f.name === "save_shift_with_obligation",
  );
  if (saveShiftFn?.exec_authenticated === true) {
    pass("rpc.save_shift.execute_authenticated", "authenticated possui EXECUTE em save_shift_with_obligation");
  } else {
    fail(
      "rpc.save_shift.execute_authenticated",
      "authenticated possui EXECUTE em save_shift_with_obligation",
      "has_function_privilege(authenticated, EXECUTE) = false ou função ausente",
    );
  }
  if (saveShiftFn?.secdef === true) {
    pass("rpc.save_shift.security_definer", "save_shift_with_obligation continua SECURITY DEFINER");
  } else {
    fail(
      "rpc.save_shift.security_definer",
      "save_shift_with_obligation continua SECURITY DEFINER",
      "pg_proc.prosecdef = false ou função ausente",
    );
  }
  if (saveShiftFn && saveShiftFn.exec_anon !== true && saveShiftFn.exec_public !== true) {
    pass("rpc.save_shift.no_anon_public", "save_shift_with_obligation SEM EXECUTE para anon/public");
  } else {
    fail(
      "rpc.save_shift.no_anon_public",
      "save_shift_with_obligation SEM EXECUTE para anon/public",
      !saveShiftFn
        ? "função ausente no catálogo"
        : `exec_anon=${String(saveShiftFn.exec_anon)} exec_public=${String(saveShiftFn.exec_public)}`,
    );
  }

  // --- public.subscription_payments ---
  const subPayRls = tableRls(catalog, "subscription_payments");
  if (subPayRls?.rls_enabled === true) {
    pass("subscription_payments.rls_enabled", "public.subscription_payments possui RLS habilitada");
  } else {
    fail(
      "subscription_payments.rls_enabled",
      "public.subscription_payments possui RLS habilitada",
      "pg_class.relrowsecurity = false ou tabela ausente",
    );
  }

  const subPayWriteTable = (catalog.tableGrants || []).some(
    (g) =>
      g.tablename === "subscription_payments" &&
      g.grantee === "authenticated" &&
      ["INSERT", "UPDATE", "DELETE"].includes(String(g.privilege).toUpperCase()),
  );
  const subPayWriteColumn = (catalog.columnGrants || []).some(
    (g) =>
      g.tablename === "subscription_payments" &&
      g.grantee === "authenticated" &&
      ["INSERT", "UPDATE"].includes(String(g.privilege).toUpperCase()),
  );
  const subPayEffectiveWrite = ["INSERT", "UPDATE", "DELETE"].some(
    (priv) =>
      effectiveTablePriv(catalog, "subscription_payments", priv) ||
      (priv !== "DELETE" && effectiveColumnPriv(catalog, "subscription_payments", priv)),
  );
  if (!subPayWriteTable && !subPayWriteColumn && !subPayEffectiveWrite) {
    pass("subscription_payments.no_write_authenticated", "authenticated SEM escrita EFETIVA em subscription_payments (INSERT/UPDATE/DELETE, inclui PUBLIC/herança)");
  } else {
    fail(
      "subscription_payments.no_write_authenticated",
      "authenticated SEM escrita EFETIVA em subscription_payments (INSERT/UPDATE/DELETE, inclui PUBLIC/herança)",
      subPayEffectiveWrite
        ? "has_table/column_privilege(authenticated, escrita) = true — inclui grants via PUBLIC/herança (drift manual?)"
        : "grant de escrita para authenticated detectado (drift manual?)",
    );
  }

  const subPaySelectPolicy = findPolicy(catalog, "subscription_payments", "subscription_payments_select_own");
  const subPayIsolated =
    subPaySelectPolicy &&
    String(subPaySelectPolicy.roles || "").includes("authenticated") &&
    canonicalPolicyExpr(subPaySelectPolicy.qual) === EXPECTED_POLICY_EXPRS.selectOwnQual;
  const subPaySelectGrant = hasTableGrant(catalog, "subscription_payments", "authenticated", "SELECT");
  if (subPaySelectGrant && subPayIsolated) {
    pass("subscription_payments.select_isolated", "subscription_payments: SELECT próprio isolado (policy canônica auth.uid() = user_id)");
  } else {
    const missing = [];
    if (!subPaySelectGrant) missing.push("grant SELECT ausente");
    if (!subPayIsolated) missing.push("policy subscription_payments_select_own ausente ou com expressão divergente/enfraquecida");
    fail(
      "subscription_payments.select_isolated",
      "subscription_payments: SELECT próprio isolado (policy canônica auth.uid() = user_id)",
      missing.join("; "),
    );
  }

  // --- public.payments ---
  const paymentsRls = tableRls(catalog, "payments");
  if (paymentsRls?.rls_enabled === true) {
    pass("payments.rls_enabled", "public.payments possui RLS habilitada");
  } else {
    fail("payments.rls_enabled", "public.payments possui RLS habilitada", "relrowsecurity = false ou tabela ausente");
  }

  const paymentsDeletePolicy = findPolicy(catalog, "payments", "payments_delete_own");
  const paymentsSelectPolicy = findPolicy(catalog, "payments", "payments_select_own");
  const paymentsSelectIsolated =
    paymentsSelectPolicy &&
    canonicalPolicyExpr(paymentsSelectPolicy.qual) === EXPECTED_POLICY_EXPRS.selectOwnQual;
  if (!paymentsDeletePolicy) {
    pass("payments.no_delete_policy", "public.payments SEM policy de DELETE (cancelamento lógico auditável)");
  } else {
    fail(
      "payments.no_delete_policy",
      "public.payments SEM policy de DELETE (cancelamento lógico auditável)",
      "policy payments_delete_own presente (delete físico reintroduzido?)",
    );
  }
  if (paymentsSelectIsolated) {
    pass("payments.select_isolated", "public.payments: SELECT próprio isolado (policy canônica auth.uid() = user_id)");
  } else {
    fail(
      "payments.select_isolated",
      "public.payments: SELECT próprio isolado (policy canônica auth.uid() = user_id)",
      "policy payments_select_own ausente ou com expressão divergente/enfraquecida",
    );
  }
  const paymentsUpdatePolicy = findPolicy(catalog, "payments", "payments_update_own");
  const paymentsUpdateRestricted =
    paymentsUpdatePolicy &&
    canonicalPolicyExpr(paymentsUpdatePolicy.with_check) === EXPECTED_POLICY_EXPRS.paymentsUpdateWithCheck;
  if (paymentsUpdateRestricted) {
    pass("payments.update_restricted", "public.payments: UPDATE próprio restrito a cancelamento lógico (WITH CHECK canônico)");
  } else {
    fail(
      "payments.update_restricted",
      "public.payments: UPDATE próprio restrito a cancelamento lógico (WITH CHECK canônico)",
      "policy payments_update_own ausente ou com expressão divergente/enfraquecida",
    );
  }

  // --- public.obligations (financial_obligations) ---
  const obligationsRls = tableRls(catalog, "obligations");
  if (obligationsRls?.rls_enabled === true) {
    pass("obligations.rls_enabled", "public.obligations possui RLS habilitada");
  } else {
    fail("obligations.rls_enabled", "public.obligations possui RLS habilitada", "relrowsecurity = false ou tabela ausente");
  }
  const obligationsEffectiveUpdate =
    effectiveTablePriv(catalog, "obligations", "UPDATE") ||
    effectiveColumnPriv(catalog, "obligations", "UPDATE", "valor_devido");
  if (
    !hasTableGrant(catalog, "obligations", "authenticated", "UPDATE") &&
    !hasColumnGrant(catalog, "obligations", "authenticated", "UPDATE", "valor_devido") &&
    !obligationsEffectiveUpdate
  ) {
    pass("obligations.no_financial_update", "authenticated SEM UPDATE EFETIVO na coluna financeira obligations.valor_devido (inclui PUBLIC/herança)");
  } else {
    fail(
      "obligations.no_financial_update",
      "authenticated SEM UPDATE EFETIVO na coluna financeira obligations.valor_devido (inclui PUBLIC/herança)",
      obligationsEffectiveUpdate
        ? "has_table/column_privilege(authenticated, UPDATE em obligations.valor_devido) = true — inclui grants via PUBLIC/herança (drift manual?)"
        : "grant UPDATE (tabela ou coluna valor_devido) detectado para authenticated",
    );
  }

  const failures = checks.filter((c) => c.status === SECURITY_STATUS.FAIL);
  return { ok: failures.length === 0, failureCount: failures.length, checks, failures };
}

/**
 *Fixture de catálogo íntegro (espelha o estado final das migrations).
 * Útil para testes e como referência documental.
 */
export function buildCompliantCatalogFixture() {
  return {
    tables: [
      { tablename: "shifts", rls_enabled: true, force_rls: false },
      { tablename: "subscription_payments", rls_enabled: true, force_rls: false },
      { tablename: "payments", rls_enabled: true, force_rls: false },
      { tablename: "obligations", rls_enabled: true, force_rls: false },
    ],
    tableGrants: [
      { tablename: "shifts", grantee: "authenticated", privilege: "SELECT" },
      { tablename: "shifts", grantee: "authenticated", privilege: "DELETE" },
      { tablename: "subscription_payments", grantee: "authenticated", privilege: "SELECT" },
      { tablename: "subscription_payments", grantee: "service_role", privilege: "ALL" },
      { tablename: "payments", grantee: "authenticated", privilege: "SELECT" },
      { tablename: "payments", grantee: "authenticated", privilege: "INSERT" },
      { tablename: "payments", grantee: "authenticated", privilege: "UPDATE" },
    ],
    columnGrants: [
      { tablename: "obligations", column_name: "data_prevista", grantee: "authenticated", privilege: "UPDATE" },
      { tablename: "obligations", column_name: "updated_at", grantee: "authenticated", privilege: "UPDATE" },
    ],
    policies: [
      { tablename: "shifts", policyname: "shifts_select_own", roles: "{authenticated}", cmd: "SELECT", qual: "(( SELECT auth.uid()) = user_id)", with_check: "" },
      { tablename: "shifts", policyname: "shifts_delete_own", roles: "{authenticated}", cmd: "DELETE", qual: "(( SELECT auth.uid()) = user_id)", with_check: "" },
      { tablename: "subscription_payments", policyname: "subscription_payments_select_own", roles: "{authenticated}", cmd: "SELECT", qual: "(( SELECT auth.uid()) = user_id)", with_check: "" },
      { tablename: "payments", policyname: "payments_select_own", roles: "{authenticated}", cmd: "SELECT", qual: "(( SELECT auth.uid()) = user_id)", with_check: "" },
      { tablename: "payments", policyname: "payments_insert_own", roles: "{authenticated}", cmd: "INSERT", qual: "", with_check: "(( SELECT auth.uid()) = user_id)" },
      { tablename: "payments", policyname: "payments_update_own", roles: "{authenticated}", cmd: "UPDATE", qual: "(( SELECT auth.uid()) = user_id)", with_check: "(( SELECT auth.uid()) = user_id AND status = 'cancelado')" },
      { tablename: "obligations", policyname: "obligations_select_own", roles: "{authenticated}", cmd: "SELECT", qual: "(( SELECT auth.uid()) = user_id)", with_check: "" },
    ],
    functions: [
      { name: "save_shift_with_obligation", args: "uuid, uuid, date, time without time zone, time without time zone, numeric, text, date, uuid, uuid, text", secdef: true, owner: "postgres", exec_authenticated: true, exec_anon: false, exec_public: false },
      { name: "register_payment", args: "uuid, numeric, date", secdef: false, owner: "postgres", exec_authenticated: true, exec_anon: false, exec_public: false },
    ],
    effectiveTablePrivs: [
      { tablename: "shifts", privilege: "SELECT", has_priv: true },
      { tablename: "shifts", privilege: "INSERT", has_priv: false },
      { tablename: "shifts", privilege: "UPDATE", has_priv: false },
      { tablename: "shifts", privilege: "DELETE", has_priv: true },
      { tablename: "shifts", privilege: "TRUNCATE", has_priv: false },
      { tablename: "subscription_payments", privilege: "SELECT", has_priv: true },
      { tablename: "subscription_payments", privilege: "INSERT", has_priv: false },
      { tablename: "subscription_payments", privilege: "UPDATE", has_priv: false },
      { tablename: "subscription_payments", privilege: "DELETE", has_priv: false },
      { tablename: "subscription_payments", privilege: "TRUNCATE", has_priv: false },
      { tablename: "payments", privilege: "SELECT", has_priv: true },
      { tablename: "payments", privilege: "INSERT", has_priv: true },
      { tablename: "payments", privilege: "UPDATE", has_priv: true },
      { tablename: "payments", privilege: "DELETE", has_priv: false },
      { tablename: "obligations", privilege: "SELECT", has_priv: true },
      { tablename: "obligations", privilege: "UPDATE", has_priv: false },
      { tablename: "obligations", privilege: "INSERT", has_priv: false },
      { tablename: "obligations", privilege: "DELETE", has_priv: false },
    ],
    effectiveColumnPrivs: [
      { tablename: "obligations", column_name: "data_prevista", privilege: "UPDATE", has_priv: true },
      { tablename: "obligations", column_name: "updated_at", privilege: "UPDATE", has_priv: true },
      { tablename: "obligations", column_name: "valor_devido", privilege: "UPDATE", has_priv: false },
    ],
  };
}

/**
 * Executa as consultas READ-ONLY no banco e avalia as invariantes.
 * Nunca executa INSERT/UPDATE/DELETE/DDL.
 */
export async function checkSecurityInvariantsViaPg(databaseUrl, options = {}) {
  const ClientClass = options.Client || PgClient;
  let client = options.client || null;
  let shouldClose = false;
  const logger = options.logger || console;

  try {
    if (!client) {
      const config = options.clientConfig || getPgClientConfigLocal(databaseUrl);
      client = new ClientClass(config);
      shouldClose = true;
      await client.connect();
    }

    const queryFn = options.queryFn || ((sql, params) => client.query(sql, params));
    const tables = SECURITY_TABLES;
    const functions = SECURITY_FUNCTIONS;

    const [rlsRes, tableGrantsRes, columnGrantsRes, policiesRes, functionsRes, effTableRes, effColumnRes] = await Promise.all([
      queryFn(SECURITY_CATALOG_QUERIES.tablesRls, [tables]),
      queryFn(SECURITY_CATALOG_QUERIES.tableGrants, [tables]),
      queryFn(SECURITY_CATALOG_QUERIES.columnGrants, [tables]),
      queryFn(SECURITY_CATALOG_QUERIES.policies, [tables]),
      queryFn(SECURITY_CATALOG_QUERIES.functions, [functions]),
      queryFn(SECURITY_CATALOG_QUERIES.effectiveTablePrivs, [tables]),
      queryFn(SECURITY_CATALOG_QUERIES.effectiveColumnPrivs, [tables]),
    ]);

    const catalog = {
      tables: (rlsRes.rows || []).map((r) => ({
        tablename: r.tablename,
        rls_enabled: r.rls_enabled === true,
        force_rls: r.force_rls === true,
      })),
      tableGrants: (tableGrantsRes.rows || []).map((r) => ({
        tablename: r.tablename,
        grantee: r.grantee,
        privilege: r.privilege,
      })),
      columnGrants: (columnGrantsRes.rows || []).map((r) => ({
        tablename: r.tablename,
        column_name: r.column_name,
        grantee: r.grantee,
        privilege: r.privilege,
      })),
      policies: (policiesRes.rows || []).map((r) => ({
        tablename: r.tablename,
        policyname: r.policyname,
        roles: r.roles,
        cmd: r.cmd,
        qual: r.qual,
        with_check: r.with_check,
      })),
      functions: (functionsRes.rows || []).map((r) => ({
        name: r.name,
        args: r.args,
        secdef: r.secdef === true,
        owner: r.owner,
        exec_authenticated: r.exec_authenticated === true,
        exec_anon: r.exec_anon === true,
        exec_public: r.exec_public === true,
      })),
      effectiveTablePrivs: (effTableRes.rows || []).map((r) => ({
        tablename: r.tablename,
        privilege: r.privilege,
        has_priv: r.has_priv === true,
      })),
      effectiveColumnPrivs: (effColumnRes.rows || []).map((r) => ({
        tablename: r.tablename,
        column_name: r.column_name,
        privilege: r.privilege,
        has_priv: r.has_priv === true,
      })),
    };

    const evaluation = evaluateSecurityInvariants(catalog);
    for (const check of evaluation.checks) {
      if (check.status === SECURITY_STATUS.PASS) {
        logger.log(`  ✓ ${check.id}: ${check.description}`);
      } else {
        logger.error(`  ✗ ${check.id}: ${check.description} — ${check.details}`);
      }
    }
    return { ok: evaluation.ok, ...evaluation, catalog, method: "pg-catalog-readonly" };
  } catch (err) {
    return {
      ok: false,
      error: redactSecretsLocal(err?.message || String(err), [databaseUrl]),
      method: "pg-catalog-readonly",
    };
  } finally {
    if (shouldClose && client && typeof client.end === "function") {
      try {
        await client.end();
      } catch {
        // Ignore disconnect cleanup errors
      }
    }
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, "/").endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  const databaseUrl = (process.env.DATABASE_URL || process.env.PRODUCTION_DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
  if (!databaseUrl) {
    console.error("[SECURITY-GATE] DATABASE_URL é obrigatória para verificação read-only do catálogo.");
    process.exit(1);
  }
  checkSecurityInvariantsViaPg(databaseUrl).then((res) => {
    if (!res.ok) process.exit(1);
  }).catch((err) => {
    console.error("[SECURITY-GATE] Falha:", redactSecretsLocal(err?.message || String(err)));
    process.exit(1);
  });
}
