import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSecurityInvariants,
  buildCompliantCatalogFixture,
  checkSecurityInvariantsViaPg,
  assertLocalDatabaseUrl,
  canonicalPolicyExpr,
  SECURITY_STATUS,
  SECURITY_CATALOG_QUERIES,
} from "../scripts/check-rls-invariants.mjs";
import { runSmokeTest } from "../scripts/smoke-test-schema.mjs";

const silentLogger = { log: () => {}, error: () => {}, warn: () => {} };

function drift(catalog, mutate) {
  const clone = JSON.parse(JSON.stringify(catalog));
  mutate(clone);
  return clone;
}

test("security-invariants: catálogo íntegro passa em todas as invariantes", () => {
  const res = evaluateSecurityInvariants(buildCompliantCatalogFixture());
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.failureCount, 0);
  assert.ok(res.checks.length >= 14, "deve checar todas as invariantes documentadas");
});

test("security-invariants: queries do verificador são somente leitura", () => {
  const forbidden = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i;
  for (const [key, sql] of Object.entries(SECURITY_CATALOG_QUERIES)) {
    const firstWord = sql.trim().split(/\s+/)[0].toLowerCase();
    assert.strictEqual(firstWord, "select", `${key} deve começar com SELECT`);
    // Remove literais de string ('INSERT', 'UPDATE', ...) antes de procurar
    // comandos de mutação/DDL/DCL fora de literais.
    const code = sql.replace(/'([^']|'')*'/g, "''");
    assert.ok(!forbidden.test(code), `${key} não deve conter mutação/DDL/DCL`);
    assert.ok(!/;\s*\S/.test(code.trim().replace(/;$/, "")), `${key} deve ser statement único`);
  }
});

test("security-invariants: drift manual de INSERT em shifts falha o gate", () => {
  const catalog = drift(buildCompliantCatalogFixture(), (c) => {
    c.tableGrants.push({ tablename: "shifts", grantee: "authenticated", privilege: "INSERT" });
  });
  const res = evaluateSecurityInvariants(catalog);
  assert.strictEqual(res.ok, false);
  assert.ok(res.failures.some((f) => f.id === "shifts.no_insert_authenticated"));
});

test("security-invariants: drift manual de UPDATE (tabela e coluna) em shifts falha o gate", () => {
  const tableDrift = drift(buildCompliantCatalogFixture(), (c) => {
    c.tableGrants.push({ tablename: "shifts", grantee: "authenticated", privilege: "UPDATE" });
  });
  assert.strictEqual(evaluateSecurityInvariants(tableDrift).ok, false);
  assert.ok(
    evaluateSecurityInvariants(tableDrift).failures.some((f) => f.id === "shifts.no_update_authenticated"),
  );

  const columnDrift = drift(buildCompliantCatalogFixture(), (c) => {
    c.columnGrants.push({ tablename: "shifts", column_name: "status", grantee: "authenticated", privilege: "UPDATE" });
  });
  const colRes = evaluateSecurityInvariants(columnDrift);
  assert.strictEqual(colRes.ok, false);
  assert.ok(colRes.failures.some((f) => f.id === "shifts.no_update_authenticated"));
});

test("security-invariants: RLS desabilitada ou policy de escrita recriada falha o gate", () => {
  const rlsOff = drift(buildCompliantCatalogFixture(), (c) => {
    c.tables.find((t) => t.tablename === "shifts").rls_enabled = false;
  });
  assert.ok(evaluateSecurityInvariants(rlsOff).failures.some((f) => f.id === "shifts.rls_enabled"));

  const policyBack = drift(buildCompliantCatalogFixture(), (c) => {
    c.policies.push({
      tablename: "shifts",
      policyname: "shifts_insert_own",
      roles: "{authenticated}",
      cmd: "INSERT",
      qual: "",
      with_check: "(( SELECT auth.uid()) = user_id)",
    });
  });
  assert.ok(
    evaluateSecurityInvariants(policyBack).failures.some((f) => f.id === "shifts.no_direct_write_policies"),
  );
});

test("security-invariants: RPC sem EXECUTE, sem SECURITY DEFINER ou com EXECUTE p/ anon falha o gate", () => {
  const noExec = drift(buildCompliantCatalogFixture(), (c) => {
    c.functions.find((f) => f.name === "save_shift_with_obligation").exec_authenticated = false;
  });
  assert.ok(
    evaluateSecurityInvariants(noExec).failures.some((f) => f.id === "rpc.save_shift.execute_authenticated"),
  );

  const noDefiner = drift(buildCompliantCatalogFixture(), (c) => {
    c.functions.find((f) => f.name === "save_shift_with_obligation").secdef = false;
  });
  assert.ok(
    evaluateSecurityInvariants(noDefiner).failures.some((f) => f.id === "rpc.save_shift.security_definer"),
  );

  const anonExec = drift(buildCompliantCatalogFixture(), (c) => {
    c.functions.find((f) => f.name === "save_shift_with_obligation").exec_anon = true;
  });
  assert.ok(
    evaluateSecurityInvariants(anonExec).failures.some((f) => f.id === "rpc.save_shift.no_anon_public"),
  );
});

test("security-invariants: escrita direta em subscription_payments ou SELECT sem isolamento falha o gate", () => {
  const writeDrift = drift(buildCompliantCatalogFixture(), (c) => {
    c.tableGrants.push({ tablename: "subscription_payments", grantee: "authenticated", privilege: "INSERT" });
  });
  assert.ok(
    evaluateSecurityInvariants(writeDrift).failures.some(
      (f) => f.id === "subscription_payments.no_write_authenticated",
    ),
  );

  const noIsolation = drift(buildCompliantCatalogFixture(), (c) => {
    c.policies.find((p) => p.policyname === "subscription_payments_select_own").qual = "(true)";
  });
  assert.ok(
    evaluateSecurityInvariants(noIsolation).failures.some(
      (f) => f.id === "subscription_payments.select_isolated",
    ),
  );
});

test("security-invariants: payments sem RLS, com DELETE ou UPDATE irrestrito falha o gate", () => {
  const deleteBack = drift(buildCompliantCatalogFixture(), (c) => {
    c.policies.push({
      tablename: "payments",
      policyname: "payments_delete_own",
      roles: "{authenticated}",
      cmd: "DELETE",
      qual: "(( SELECT auth.uid()) = user_id)",
      with_check: "",
    });
  });
  assert.ok(
    evaluateSecurityInvariants(deleteBack).failures.some((f) => f.id === "payments.no_delete_policy"),
  );

  const updateOpen = drift(buildCompliantCatalogFixture(), (c) => {
    c.policies.find((p) => p.policyname === "payments_update_own").with_check =
      "(( SELECT auth.uid()) = user_id)";
  });
  assert.ok(
    evaluateSecurityInvariants(updateOpen).failures.some((f) => f.id === "payments.update_restricted"),
  );
});

test("security-invariants: UPDATE financeiro direto em obligations.valor_devido falha o gate", () => {
  const financialDrift = drift(buildCompliantCatalogFixture(), (c) => {
    c.columnGrants.push({
      tablename: "obligations",
      column_name: "valor_devido",
      grantee: "authenticated",
      privilege: "UPDATE",
    });
  });
  const res = evaluateSecurityInvariants(financialDrift);
  assert.strictEqual(res.ok, false);
  assert.ok(res.failures.some((f) => f.id === "obligations.no_financial_update"));
});

function makeSecurityQueryFn(catalog) {
  return async (sql, params) => {
    if (sql.includes("has_table_privilege")) return { rows: catalog.effectiveTablePrivs || [] };
    if (sql.includes("has_column_privilege")) return { rows: catalog.effectiveColumnPrivs || [] };
    if (sql.includes("pg_class")) return { rows: catalog.tables };
    if (sql.includes("role_column_grants")) return { rows: catalog.columnGrants };
    if (sql.includes("role_table_grants")) return { rows: catalog.tableGrants };
    if (sql.includes("pg_policies")) return { rows: catalog.policies };
    if (sql.includes("pg_proc")) return { rows: catalog.functions };
    throw new Error(`unexpected catalog query: ${String(sql).slice(0, 60)}`);
  };
}

// Mapeia a fixture completa (inclui privilégios efetivos) para o mock.
function mockCatalogFromFixture(c) {
  return {
    tables: c.tables,
    tableGrants: c.tableGrants,
    columnGrants: c.columnGrants,
    policies: c.policies,
    functions: c.functions,
    effectiveTablePrivs: c.effectiveTablePrivs || [],
    effectiveColumnPrivs: c.effectiveColumnPrivs || [],
  };
}

test("security-invariants: checkSecurityInvariantsViaPg usa somente catálogo (mock) e falha em drift", async () => {
  const compliant = buildCompliantCatalogFixture();
  const okRes = await checkSecurityInvariantsViaPg("postgresql://localhost:5432/postgres", {
    queryFn: makeSecurityQueryFn({
      tables: compliant.tables.map((t) => ({ tablename: t.tablename, rls_enabled: t.rls_enabled, force_rls: false })),
      tableGrants: compliant.tableGrants.map((g) => ({ tablename: g.tablename, grantee: g.grantee, privilege: g.privilege })),
      columnGrants: compliant.columnGrants.map((g) => ({ tablename: g.tablename, column_name: g.column_name, grantee: g.grantee, privilege: g.privilege })),
      policies: compliant.policies,
      functions: compliant.functions.map((f) => ({
        name: f.name,
        args: f.args,
        secdef: f.secdef,
        owner: f.owner,
        exec_authenticated: f.exec_authenticated,
        exec_anon: f.exec_anon,
        exec_public: f.exec_public,
      })),
    }),
    client: { query: async () => ({ rows: [] }), end: async () => {} },
    logger: silentLogger,
  });
  assert.strictEqual(okRes.ok, true);
  assert.strictEqual(okRes.method, "pg-catalog-readonly");

  const drifted = drift(compliant, (c) => {
    c.tableGrants.push({ tablename: "shifts", grantee: "authenticated", privilege: "INSERT" });
  });
  const failRes = await checkSecurityInvariantsViaPg("postgresql://localhost:5432/postgres", {
    queryFn: makeSecurityQueryFn({
      tables: drifted.tables.map((t) => ({ tablename: t.tablename, rls_enabled: t.rls_enabled, force_rls: false })),
      tableGrants: drifted.tableGrants.map((g) => ({ tablename: g.tablename, grantee: g.grantee, privilege: g.privilege })),
      columnGrants: drifted.columnGrants,
      policies: drifted.policies,
      functions: drifted.functions.map((f) => ({
        name: f.name,
        args: f.args,
        secdef: f.secdef,
        owner: f.owner,
        exec_authenticated: f.exec_authenticated,
        exec_anon: f.exec_anon,
        exec_public: f.exec_public,
      })),
    }),
    client: { query: async () => ({ rows: [] }), end: async () => {} },
    logger: silentLogger,
  });
  assert.strictEqual(failRes.ok, false);
  assert.ok(failRes.failures.some((f) => f.id === "shifts.no_insert_authenticated"));
  assert.strictEqual(failRes.checks.find((c) => c.id === "shifts.no_insert_authenticated").status, SECURITY_STATUS.FAIL);
});

test("security-invariants: production gate strict falha quando invariante diverge (mock pg)", async () => {
  const validRows = [
    { proname: "save_shift_with_obligation", pronargs: 11, argtypes: "uuid, uuid, date, time without time zone, time without time zone, numeric, text, date, uuid, uuid, text" },
    { proname: "register_payment", pronargs: 3, argtypes: "uuid, numeric, date" },
    { proname: "process_mercadopago_subscription_payment", pronargs: 6, argtypes: "text, uuid, integer, integer, numeric, text" },
    { proname: "reconcile_mercadopago_reversal", pronargs: 6, argtypes: "text, uuid, text, integer, integer, numeric" },
  ];
  class MockRpcClient {
    async connect() {}
    async query() {
      return { rows: validRows };
    }
    async end() {}
  }
  const compliant = buildCompliantCatalogFixture();
  const compliantQueryFn = makeSecurityQueryFn({
    tables: compliant.tables.map((t) => ({ tablename: t.tablename, rls_enabled: t.rls_enabled, force_rls: false })),
    tableGrants: compliant.tableGrants.map((g) => ({ tablename: g.tablename, grantee: g.grantee, privilege: g.privilege })),
    columnGrants: compliant.columnGrants,
    policies: compliant.policies,
    functions: compliant.functions.map((f) => ({
      name: f.name,
      args: f.args,
      secdef: f.secdef,
      owner: f.owner,
      exec_authenticated: f.exec_authenticated,
      exec_anon: f.exec_anon,
      exec_public: f.exec_public,
    })),
  });

  // Gate passa com RPCs + invariantes íntegras
  const passRes = await runSmokeTest({
    databaseUrl: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    logger: silentLogger,
    Client: MockRpcClient,
    securityQueryFn: compliantQueryFn,
    securityClient: { query: async () => ({ rows: [] }), end: async () => {} },
    strict: true,
  });
  assert.strictEqual(passRes.ok, true);

  // Gate falha quando há drift (INSERT direto em shifts), mesmo com RPCs íntegras
  const drifted = drift(compliant, (c) => {
    c.tableGrants.push({ tablename: "shifts", grantee: "authenticated", privilege: "INSERT" });
  });
  const driftQueryFn = makeSecurityQueryFn({
    tables: drifted.tables.map((t) => ({ tablename: t.tablename, rls_enabled: t.rls_enabled, force_rls: false })),
    tableGrants: drifted.tableGrants.map((g) => ({ tablename: g.tablename, grantee: g.grantee, privilege: g.privilege })),
    columnGrants: drifted.columnGrants,
    policies: drifted.policies,
    functions: drifted.functions.map((f) => ({
      name: f.name,
      args: f.args,
      secdef: f.secdef,
      owner: f.owner,
      exec_authenticated: f.exec_authenticated,
      exec_anon: f.exec_anon,
      exec_public: f.exec_public,
    })),
  });
  const failRes = await runSmokeTest({
    databaseUrl: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    logger: silentLogger,
    Client: MockRpcClient,
    securityQueryFn: driftQueryFn,
    securityClient: { query: async () => ({ rows: [] }), end: async () => {} },
    strict: true,
  });
  assert.strictEqual(failRes.ok, false, "Gate strict deve falhar em drift de segurança");
  assert.ok(failRes.security && failRes.security.ok === false);
});

// --- MAI-135: privilégios efetivos via PUBLIC/herança (falso negativo do SHA 4cd5c5a) ---

function publicDriftCatalog(mutator) {
  return drift(buildCompliantCatalogFixture(), mutator);
}

function setEffective(catalog, tablename, privilege, hasPriv, columnName = null) {
  if (columnName) {
    const entry = catalog.effectiveColumnPrivs.find(
      (e) => e.tablename === tablename && e.column_name === columnName && e.privilege === privilege,
    );
    if (entry) entry.has_priv = hasPriv;
    else catalog.effectiveColumnPrivs.push({ tablename, column_name: columnName, privilege, has_priv: hasPriv });
  } else {
    const entry = catalog.effectiveTablePrivs.find(
      (e) => e.tablename === tablename && e.privilege === privilege,
    );
    if (entry) entry.has_priv = hasPriv;
    else catalog.effectiveTablePrivs.push({ tablename, privilege, has_priv: hasPriv });
  }
}

test("security-invariants (MAI-135): PUBLIC com INSERT em shifts falha o gate", () => {
  const catalog = publicDriftCatalog((c) => {
    c.tableGrants.push({ tablename: "shifts", grantee: "PUBLIC", privilege: "INSERT" });
    setEffective(c, "shifts", "INSERT", true);
  });
  const res = evaluateSecurityInvariants(catalog);
  assert.strictEqual(res.ok, false);
  const check = res.checks.find((x) => x.id === "shifts.no_insert_authenticated");
  assert.strictEqual(check.status, SECURITY_STATUS.FAIL);
  assert.ok(check.details.includes("PUBLIC"), "detalhe deve indicar via PUBLIC/herança");
});

test("security-invariants (MAI-135): PUBLIC com UPDATE em shifts falha o gate", () => {
  const catalog = publicDriftCatalog((c) => {
    c.tableGrants.push({ tablename: "shifts", grantee: "PUBLIC", privilege: "UPDATE" });
    setEffective(c, "shifts", "UPDATE", true);
  });
  const res = evaluateSecurityInvariants(catalog);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.checks.find((x) => x.id === "shifts.no_update_authenticated").status, SECURITY_STATUS.FAIL);
});

test("security-invariants (MAI-135): escrita efetiva via PUBLIC em subscription_payments falha o gate", () => {
  for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
    const catalog = publicDriftCatalog((c) => {
      c.tableGrants.push({ tablename: "subscription_payments", grantee: "PUBLIC", privilege: priv });
      setEffective(c, "subscription_payments", priv, true);
    });
    const res = evaluateSecurityInvariants(catalog);
    assert.strictEqual(res.ok, false, `PUBLIC ${priv} deve falhar o gate`);
    assert.strictEqual(
      res.checks.find((x) => x.id === "subscription_payments.no_write_authenticated").status,
      SECURITY_STATUS.FAIL,
    );
  }
});

test("security-invariants (MAI-135): PUBLIC com UPDATE em obligations.valor_devido falha o gate", () => {
  const catalog = publicDriftCatalog((c) => {
    c.columnGrants.push({ tablename: "obligations", column_name: "valor_devido", grantee: "PUBLIC", privilege: "UPDATE" });
    setEffective(c, "obligations", "UPDATE", true, "valor_devido");
  });
  const res = evaluateSecurityInvariants(catalog);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.checks.find((x) => x.id === "obligations.no_financial_update").status, SECURITY_STATUS.FAIL);
});

test("security-invariants (MAI-135): SHA auditado 4cd5c5a não detecta drift via PUBLIC (falso negativo)", async () => {
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, unlinkSync } = await import("node:fs");
  const { pathToFileURL, fileURLToPath } = await import("node:url");

  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  let oldSource;
  try {
    oldSource = execFileSync("git", ["show", "4cd5c5a:scripts/check-rls-invariants.mjs"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    console.warn("SHA auditado indisponível no clone; prova do falso negativo pulada.");
    return;
  }
  // Arquivo temporário DENTRO do repo para que `import "pg"` resolva via node_modules.
  const tmpFile = fileURLToPath(new URL("./.tmp-check-rls-invariants-old.mjs", import.meta.url));
  writeFileSync(tmpFile, oldSource);
  try {
    const oldModule = await import(pathToFileURL(tmpFile).href);
    // Catálogo como o banco real retornaria sob GRANT ... TO PUBLIC:
    // nenhuma linha nominal para authenticated, privilégio efetivo presente.
    const catalog = publicDriftCatalog((c) => {
      c.tableGrants.push({ tablename: "shifts", grantee: "PUBLIC", privilege: "INSERT" });
      delete c.effectiveTablePrivs;
      delete c.effectiveColumnPrivs;
    });
    const oldRes = oldModule.evaluateSecurityInvariants(catalog);
    assert.strictEqual(oldRes.ok, true, "SHA auditado deve exibir o falso negativo (ok:true sob drift PUBLIC)");

    const newCatalog = publicDriftCatalog((c) => {
      c.tableGrants.push({ tablename: "shifts", grantee: "PUBLIC", privilege: "INSERT" });
      setEffective(c, "shifts", "INSERT", true);
    });
    const newRes = evaluateSecurityInvariants(newCatalog);
    assert.strictEqual(newRes.ok, false, "Novo checker deve falhar sob o mesmo drift PUBLIC");
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
});

// --- Auditoria final PR #129: safety guard do teste real (fail-closed) ---

test("safety-guard: somente hosts locais explícitos são aceitos", () => {
  assert.strictEqual(assertLocalDatabaseUrl("postgresql://postgres:postgres@127.0.0.1:55433/postgres"), "127.0.0.1");
  assert.strictEqual(assertLocalDatabaseUrl("postgresql://postgres:postgres@localhost:5432/postgres"), "localhost");
  assert.strictEqual(assertLocalDatabaseUrl("postgresql://postgres:postgres@[::1]:5432/postgres"), "[::1]");
  assert.strictEqual(assertLocalDatabaseUrl("postgres://user:pw@LOCALHOST:5432/db"), "localhost");
});

test("safety-guard: hosts remotos abortam sem conectar e sem vazar credenciais", () => {
  const blocked = [
    "postgresql://postgres:SuperSecret123@db.abcdef.supabase.co:5432/postgres",
    "postgresql://postgres:SuperSecret123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
    "postgresql://admin:SuperSecret123@prod.example.com:5432/postgres",
    "postgresql://postgres:SuperSecret123@192.168.1.10:5432/postgres",
    "postgresql://postgres:SuperSecret123@[2001:db8::1]:5432/postgres",
    "not-a-url",
    "",
  ];
  for (const url of blocked) {
    assert.throws(() => assertLocalDatabaseUrl(url), /FAIL-CLOSED/, `deve bloquear: ${url.replace(/:[^:@/]+@/, ":[REDACTED]@")}`);
  }
  // A mensagem de erro nunca vaza a senha.
  try {
    assertLocalDatabaseUrl("postgresql://postgres:SuperSecret123@db.abcdef.supabase.co:5432/postgres");
    assert.fail("deveria ter lançado");
  } catch (err) {
    assert.ok(!String(err.message).includes("SuperSecret123"), "erro sanitizado não vaza senha");
    assert.ok(String(err.message).includes("db.abcdef.supabase.co"), "erro indica o host bloqueado");
  }
});

// --- Auditoria final PR #129: policies enfraquecidas com OR true ---

function weakenedPolicyCatalog(policyname, tablename, field, weakenedExpr) {
  return drift(buildCompliantCatalogFixture(), (c) => {
    const policy = c.policies.find((p) => p.policyname === policyname && p.tablename === tablename);
    assert.ok(policy, `fixture deve conter policy ${policyname}`);
    policy[field] = weakenedExpr;
  });
}

test("policies: shifts_select_own com OR true FALHA o gate", () => {
  const res = evaluateSecurityInvariants(
    weakenedPolicyCatalog("shifts_select_own", "shifts", "qual", "((SELECT auth.uid()) = user_id OR true)"),
  );
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.checks.find((c) => c.id === "shifts.select_own").status, SECURITY_STATUS.FAIL);
});

test("policies: subscription_payments_select_own com OR true FALHA o gate", () => {
  const res = evaluateSecurityInvariants(
    weakenedPolicyCatalog(
      "subscription_payments_select_own",
      "subscription_payments",
      "qual",
      "((SELECT auth.uid()) = user_id OR true)",
    ),
  );
  assert.strictEqual(res.ok, false);
  assert.strictEqual(
    res.checks.find((c) => c.id === "subscription_payments.select_isolated").status,
    SECURITY_STATUS.FAIL,
  );
});

test("policies: payments_select_own com OR true FALHA o gate", () => {
  const res = evaluateSecurityInvariants(
    weakenedPolicyCatalog("payments_select_own", "payments", "qual", "((SELECT auth.uid()) = user_id OR true)"),
  );
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.checks.find((c) => c.id === "payments.select_isolated").status, SECURITY_STATUS.FAIL);
});

test("policies: payments_update_own com OR true no WITH CHECK FALHA o gate", () => {
  const res = evaluateSecurityInvariants(
    weakenedPolicyCatalog(
      "payments_update_own",
      "payments",
      "with_check",
      "((SELECT auth.uid()) = user_id AND (status = 'cancelado' OR true))",
    ),
  );
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.checks.find((c) => c.id === "payments.update_restricted").status, SECURITY_STATUS.FAIL);
});

test("policies: expressões canônicas íntegras continuam passando", () => {
  assert.strictEqual(canonicalPolicyExpr("(( SELECT auth.uid()) = user_id)"), "auth.uid=user_id");
  assert.strictEqual(canonicalPolicyExpr("(auth.uid() = user_id)"), "auth.uid=user_id");
  assert.strictEqual(
    canonicalPolicyExpr("(( SELECT auth.uid()) = user_id AND status = 'cancelado')"),
    "auth.uid=user_idandstatus='cancelado'",
  );
  // Forma enfraquecida jamais colapsa para a canônica íntegra.
  assert.notStrictEqual(canonicalPolicyExpr("((SELECT auth.uid()) = user_id OR true)"), "auth.uid=user_id");
  const res = evaluateSecurityInvariants(buildCompliantCatalogFixture());
  assert.strictEqual(res.ok, true);
});
