import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPECTED_SCHEMA_CONTRACT_VERSION,
  CONTRACT_STATUS,
  parseSemver,
  compareSemver,
  evaluateSchemaContract,
  checkSchemaContractViaPg,
  checkSchemaContractViaRest,
} from "../scripts/schema-contract.mjs";
import { runSmokeTest } from "../scripts/smoke-test-schema.mjs";
import { verifyProductionSchema } from "../scripts/verify-production-schema.mjs";
import { buildCompliantCatalogFixture } from "../scripts/check-rls-invariants.mjs";

function compliantCatalogMocks(overrides = {}) {
  const c = buildCompliantCatalogFixture();
  const rows = {
    tables: c.tables.map((t) => ({ tablename: t.tablename, rls_enabled: t.rls_enabled, force_rls: false })),
    tableGrants: c.tableGrants.map((g) => ({ tablename: g.tablename, grantee: g.grantee, privilege: g.privilege })),
    columnGrants: c.columnGrants,
    policies: c.policies,
    functions: c.functions.map((f) => ({
      name: f.name,
      args: f.args,
      secdef: f.secdef,
      owner: f.owner,
      exec_authenticated: f.exec_authenticated,
      exec_anon: f.exec_anon,
      exec_public: f.exec_public,
    })),
    effectiveTablePrivs: c.effectiveTablePrivs || [],
    effectiveColumnPrivs: c.effectiveColumnPrivs || [],
  };

  const contractVersion = overrides.contractVersion !== undefined ? overrides.contractVersion : EXPECTED_SCHEMA_CONTRACT_VERSION;
  const contractMissingTable = overrides.contractMissingTable === true;
  const contractMissingRow = overrides.contractMissingRow === true;
  const contractThrowError = overrides.contractThrowError;

  const securityQueryFn = async (sql) => {
    if (sql.includes("has_table_privilege")) return { rows: rows.effectiveTablePrivs };
    if (sql.includes("has_column_privilege")) return { rows: rows.effectiveColumnPrivs };
    if (sql.includes("pg_class")) return { rows: rows.tables };
    if (sql.includes("role_column_grants")) return { rows: rows.columnGrants };
    if (sql.includes("role_table_grants")) return { rows: rows.tableGrants };
    if (sql.includes("pg_policies")) return { rows: rows.policies };
    if (sql.includes("pg_proc")) return { rows: rows.functions };
    throw new Error("unexpected catalog query: " + sql);
  };

  const contractQueryFn = async (sql) => {
    if (contractThrowError) {
      throw new Error(contractThrowError);
    }
    if (sql.includes("to_regclass")) {
      return { rows: [{ regclass: contractMissingTable ? null : "public.schema_contract" }] };
    }
    if (sql.includes("schema_contract")) {
      if (contractMissingRow) return { rows: [] };
      return {
        rows: [
          {
            contract_version: contractVersion,
            description: "Mock semantic contract",
            applied_by: "postgres",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };
    }
    return { rows: [] };
  };

  return {
    securityQueryFn,
    securityClient: { query: securityQueryFn, end: async () => {} },
    contractQueryFn,
    contractClient: { query: contractQueryFn, end: async () => {} },
  };
}

const validRpcRows = [
  {
    proname: "save_shift_with_obligation",
    pronargs: 11,
    argtypes: "uuid, uuid, date, time without time zone, time without time zone, numeric, text, date, uuid, uuid, text",
  },
  {
    proname: "register_payment",
    pronargs: 3,
    argtypes: "uuid, numeric, date",
  },
  {
    proname: "process_mercadopago_subscription_payment",
    pronargs: 7,
    argtypes: "text, uuid, integer, integer, numeric, text, uuid",
  },
  {
    proname: "reconcile_mercadopago_reversal",
    pronargs: 6,
    argtypes: "text, uuid, text, integer, integer, numeric",
  },
];

function createProcClient(rows = validRpcRows) {
  return class MockProcClient {
    async connect() {}
    async query(sql) {
      return { rows };
    }
    async end() {}
  };
}

test("schema-contract: EXPECTED_SCHEMA_CONTRACT_VERSION is valid SemVer", () => {
  assert.strictEqual(typeof EXPECTED_SCHEMA_CONTRACT_VERSION, "string");
  const parsed = parseSemver(EXPECTED_SCHEMA_CONTRACT_VERSION);
  assert.ok(parsed, "EXPECTED_SCHEMA_CONTRACT_VERSION must parse cleanly as semver");
  assert.strictEqual(parsed.raw, "1.0.0");
});

test("schema-contract: parseSemver strictly accepts MAJOR.MINOR.PATCH and rejects malformed versions", () => {
  // Valid
  assert.deepStrictEqual(parseSemver("1.0.0"), { major: 1, minor: 0, patch: 0, raw: "1.0.0" });
  assert.deepStrictEqual(parseSemver("0.1.2"), { major: 0, minor: 1, patch: 2, raw: "0.1.2" });
  assert.deepStrictEqual(parseSemver("10.200.345"), { major: 10, minor: 200, patch: 345, raw: "10.200.345" });

  // Invalid formats
  assert.strictEqual(parseSemver("v1.0.0"), null, "Leading 'v' not allowed in strict semver");
  assert.strictEqual(parseSemver("1.0"), null, "Missing patch component");
  assert.strictEqual(parseSemver("1"), null, "Single number invalid");
  assert.strictEqual(parseSemver("1.0.0.0"), null, "Too many components");
  assert.strictEqual(parseSemver("abc"), null, "Non-numeric string");
  assert.strictEqual(parseSemver("1.0.0-beta"), null, "Prerelease not allowed in strict DB contract");
  assert.strictEqual(parseSemver(""), null, "Empty string");
  assert.strictEqual(parseSemver(null), null, "Null");
  assert.strictEqual(parseSemver(undefined), null, "Undefined");
  assert.strictEqual(parseSemver("01.0.0"), null, "Leading zero on non-zero component invalid");
});

test("schema-contract: compareSemver correctly orders versions", () => {
  assert.strictEqual(compareSemver("1.0.0", "1.0.0"), 0);
  assert.strictEqual(compareSemver("1.1.0", "1.0.0"), 1);
  assert.strictEqual(compareSemver("1.0.1", "1.0.0"), 1);
  assert.strictEqual(compareSemver("2.0.0", "1.9.9"), 1);

  assert.strictEqual(compareSemver("1.0.0", "1.1.0"), -1);
  assert.strictEqual(compareSemver("1.0.0", "1.0.1"), -1);
  assert.strictEqual(compareSemver("0.9.9", "1.0.0"), -1);
});

test("schema-contract: evaluateSchemaContract handles all 5 contract states", () => {
  // 1. Versão correta (exact match or forward-compatible same major)
  const resCorrect = evaluateSchemaContract("1.0.0", "1.0.0");
  assert.strictEqual(resCorrect.ok, true);
  assert.strictEqual(resCorrect.status, CONTRACT_STATUS.CORRECT);

  const resForward = evaluateSchemaContract("1.1.0", "1.0.0");
  assert.strictEqual(resForward.ok, true);
  assert.strictEqual(resForward.status, CONTRACT_STATUS.CORRECT);

  // 2. Versão antiga (installed < expected)
  const resOutdated = evaluateSchemaContract("0.9.0", "1.0.0");
  assert.strictEqual(resOutdated.ok, false);
  assert.strictEqual(resOutdated.status, CONTRACT_STATUS.OUTDATED);
  assert.ok(resOutdated.details.includes("anterior à mínima esperada"));

  // 2b. Incompatible major
  const resMajorMismatch = evaluateSchemaContract("2.0.0", "1.0.0");
  assert.strictEqual(resMajorMismatch.ok, false);
  assert.strictEqual(resMajorMismatch.status, CONTRACT_STATUS.OUTDATED);
  assert.ok(resMajorMismatch.details.includes("major"));

  // 3. Marcador ausente (null, undefined, empty)
  const resMissingNull = evaluateSchemaContract(null, "1.0.0");
  assert.strictEqual(resMissingNull.ok, false);
  assert.strictEqual(resMissingNull.status, CONTRACT_STATUS.MISSING);

  const resMissingEmpty = evaluateSchemaContract("", "1.0.0");
  assert.strictEqual(resMissingEmpty.ok, false);
  assert.strictEqual(resMissingEmpty.status, CONTRACT_STATUS.MISSING);

  // 4. Formato inválido
  const resInvalid = evaluateSchemaContract("invalid_version_str", "1.0.0");
  assert.strictEqual(resInvalid.ok, false);
  assert.strictEqual(resInvalid.status, CONTRACT_STATUS.INVALID_FORMAT);
  assert.ok(resInvalid.details.includes("MAJOR.MINOR.PATCH"));
});

test("schema-contract: checkSchemaContractViaPg detects correct, outdated, missing and invalid states", async () => {
  const dbUrl = "postgresql://postgres:secret@127.0.0.1:5432/test";

  // Case A: Correct version -> PASS
  const mocksCorrect = compliantCatalogMocks({ contractVersion: "1.0.0" });
  const checkCorrect = await checkSchemaContractViaPg(dbUrl, {
    contractQueryFn: mocksCorrect.contractQueryFn,
  });
  assert.strictEqual(checkCorrect.ok, true);
  assert.strictEqual(checkCorrect.status, CONTRACT_STATUS.CORRECT);
  assert.strictEqual(checkCorrect.installedVersion, "1.0.0");

  // Case B: Outdated version -> FAIL (status OUTDATED)
  const mocksOutdated = compliantCatalogMocks({ contractVersion: "0.9.0" });
  const checkOutdated = await checkSchemaContractViaPg(dbUrl, {
    contractQueryFn: mocksOutdated.contractQueryFn,
  });
  assert.strictEqual(checkOutdated.ok, false);
  assert.strictEqual(checkOutdated.status, CONTRACT_STATUS.OUTDATED);

  // Case C: Missing table -> FAIL (status MISSING)
  const mocksMissingTable = compliantCatalogMocks({ contractMissingTable: true });
  const checkMissingTable = await checkSchemaContractViaPg(dbUrl, {
    contractQueryFn: mocksMissingTable.contractQueryFn,
  });
  assert.strictEqual(checkMissingTable.ok, false);
  assert.strictEqual(checkMissingTable.status, CONTRACT_STATUS.MISSING);
  assert.ok(checkMissingTable.details.includes("não existe no banco"));

  // Case D: Missing row -> FAIL (status MISSING)
  const mocksMissingRow = compliantCatalogMocks({ contractMissingRow: true });
  const checkMissingRow = await checkSchemaContractViaPg(dbUrl, {
    contractQueryFn: mocksMissingRow.contractQueryFn,
  });
  assert.strictEqual(checkMissingRow.ok, false);
  assert.strictEqual(checkMissingRow.status, CONTRACT_STATUS.MISSING);
  assert.ok(checkMissingRow.details.includes("singleton (id = 1) ausente"));

  // Case E: Invalid format -> FAIL (status INVALID_FORMAT)
  const mocksInvalidFormat = compliantCatalogMocks({ contractVersion: "not-a-semver" });
  const checkInvalidFormat = await checkSchemaContractViaPg(dbUrl, {
    contractQueryFn: mocksInvalidFormat.contractQueryFn,
  });
  assert.strictEqual(checkInvalidFormat.ok, false);
  assert.strictEqual(checkInvalidFormat.status, CONTRACT_STATUS.INVALID_FORMAT);

  // Case F: Connection error -> FAIL (status CONNECTION_ERROR, secrets redacted)
  const mocksConnError = compliantCatalogMocks({ contractThrowError: "connection to postgresql://postgres:superSecret123@pooler.supabase.com:5432/postgres failed" });
  const checkConnError = await checkSchemaContractViaPg(dbUrl, {
    contractQueryFn: mocksConnError.contractQueryFn,
  });
  assert.strictEqual(checkConnError.ok, false);
  assert.strictEqual(checkConnError.status, CONTRACT_STATUS.CONNECTION_ERROR);
  assert.strictEqual(checkConnError.error.includes("superSecret123"), false);
  assert.strictEqual(checkConnError.error.includes("[REDACTED]"), true);
});

test("schema-contract: verifyProductionSchema gate fails closed on contract defects in strict mode", async () => {
  const silentLogger = { log: () => {}, error: () => {}, warn: () => {} };
  const Client = createProcClient();

  // 1. Strict mode with correct contract -> ok: true
  const correctMocks = compliantCatalogMocks({ contractVersion: "1.0.0" });
  const resPass = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    },
    logger: silentLogger,
    Client,
    ...correctMocks,
  });
  assert.strictEqual(resPass.ok, true, "Correct contract version must pass in strict production");
  assert.strictEqual(resPass.strict, true);
  assert.strictEqual(resPass.contract.status, CONTRACT_STATUS.CORRECT);

  // 2. Strict mode with outdated contract -> ok: false (FAIL CLOSED)
  const outdatedMocks = compliantCatalogMocks({ contractVersion: "0.9.0" });
  const resOutdated = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    },
    logger: silentLogger,
    Client,
    ...outdatedMocks,
  });
  assert.strictEqual(resOutdated.ok, false, "Outdated contract must fail closed in strict production");
  assert.strictEqual(resOutdated.strict, true);
  assert.strictEqual(resOutdated.contract.status, CONTRACT_STATUS.OUTDATED);
  assert.ok(resOutdated.error.includes("Semantic schema contract verification failed"));

  // 3. Strict mode with missing contract table -> ok: false (FAIL CLOSED)
  const missingTableMocks = compliantCatalogMocks({ contractMissingTable: true });
  const resMissing = await verifyProductionSchema({
    env: {
      CHECK_SCHEMA_COMPATIBILITY: "1",
      DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    },
    logger: silentLogger,
    Client,
    ...missingTableMocks,
  });
  assert.strictEqual(resMissing.ok, false, "Missing contract table must fail closed in strict production");
  assert.strictEqual(resMissing.contract.status, CONTRACT_STATUS.MISSING);

  // 4. Strict mode with invalid contract format -> ok: false (FAIL CLOSED)
  const invalidFormatMocks = compliantCatalogMocks({ contractVersion: "beta-1.0" });
  const resInvalid = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    },
    logger: silentLogger,
    Client,
    ...invalidFormatMocks,
  });
  assert.strictEqual(resInvalid.ok, false, "Invalid format must fail closed in strict production");
  assert.strictEqual(resInvalid.contract.status, CONTRACT_STATUS.INVALID_FORMAT);

  // 5. Strict mode with connection error -> ok: false (FAIL CLOSED, secrets redacted)
  const connErrorMocks = compliantCatalogMocks({ contractThrowError: "connection to postgresql://postgres:leakedPasswordXYZ@pooler.supabase.com:5432/postgres failed" });
  const resConnError = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    },
    logger: silentLogger,
    Client,
    ...connErrorMocks,
  });
  assert.strictEqual(resConnError.ok, false, "DB error must fail closed in strict production");
  assert.strictEqual(resConnError.contract.status, CONTRACT_STATUS.CONNECTION_ERROR);
  assert.strictEqual(resConnError.error.includes("leakedPasswordXYZ"), false);
  assert.strictEqual(resConnError.error.includes("[REDACTED]"), true);
});

test("schema-contract: preview and local non-strict environments remain non-blocking", async () => {
  const silentLogger = { log: () => {}, error: () => {}, warn: () => {} };
  const Client = createProcClient();

  // Outdated contract in Vercel Preview -> non-blocking diagnostic warning
  const outdatedMocks = compliantCatalogMocks({ contractVersion: "0.8.0" });
  const resPreview = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "preview",
      DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    },
    logger: silentLogger,
    Client,
    ...outdatedMocks,
  });
  assert.strictEqual(resPreview.ok, true, "Outdated contract in preview must NOT block build");
  assert.strictEqual(resPreview.warned, true);
  assert.strictEqual(resPreview.preview, true);

  // Local/mock build without DATABASE_URL -> safe bypass preserved
  const resLocal = await verifyProductionSchema({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    },
    logger: silentLogger,
  });
  assert.strictEqual(resLocal.ok, true);
  assert.strictEqual(resLocal.bypassed, true);
});

test("schema-contract: checkSchemaContractViaRest checks REST API when service_role is present", async () => {
  // HTTP 200 with valid version
  const fetch200 = async () => ({
    status: 200,
    json: async () => [{ contract_version: "1.0.0" }],
  });
  const res200 = await checkSchemaContractViaRest("https://test.supabase.co", "service-key", { fetchFn: fetch200 });
  assert.strictEqual(res200.ok, true);
  assert.strictEqual(res200.status, CONTRACT_STATUS.CORRECT);

  // HTTP 404 (route missing)
  const fetch404 = async () => ({ status: 404 });
  const res404 = await checkSchemaContractViaRest("https://test.supabase.co", "service-key", { fetchFn: fetch404 });
  assert.strictEqual(res404.ok, false);
  assert.strictEqual(res404.status, CONTRACT_STATUS.MISSING);

  // HTTP 200 with outdated version
  const fetchOutdated = async () => ({
    status: 200,
    json: async () => [{ contract_version: "0.5.0" }],
  });
  const resOutdated = await checkSchemaContractViaRest("https://test.supabase.co", "service-key", { fetchFn: fetchOutdated });
  assert.strictEqual(resOutdated.ok, false);
  assert.strictEqual(resOutdated.status, CONTRACT_STATUS.OUTDATED);
});
