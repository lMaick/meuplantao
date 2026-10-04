#!/usr/bin/env node
/**
 * MeuPlantao — Semantic Schema Contract Gate (MAI-158)
 *
 * Verifies that the production database has the expected semantic schema contract version
 * explicitly recorded in public.schema_contract.
 *
 * Prevents false positives where RPCs have the correct argument types but retain
 * outdated internal logic from earlier migrations.
 *
 * Contract status:
 *  - CORRECT: installedVersion satisfies expectedVersion (same major, installed >= expected)
 *  - OUTDATED: installedVersion < expectedVersion or incompatible major
 *  - MISSING: table or singleton record absent in target database
 *  - INVALID_FORMAT: installedVersion is not valid semver (MAJOR.MINOR.PATCH)
 *  - CONNECTION_ERROR: target database unreachable / connection failure
 */

import pg from "pg";
import { redactSecrets, getPgClientConfig } from "./smoke-test-schema.mjs";

const { Client: PgClient } = pg;

/**
 * Expected schema contract version required by the application runtime.
 * This value MUST be bumped only when migrations alter schema or RPC semantics.
 */
export const EXPECTED_SCHEMA_CONTRACT_VERSION = "1.0.0";

export const CONTRACT_STATUS = {
  CORRECT: "CORRECT",
  OUTDATED: "OUTDATED",
  MISSING: "MISSING",
  INVALID_FORMAT: "INVALID_FORMAT",
  CONNECTION_ERROR: "CONNECTION_ERROR",
};

export const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Parses a semver string strictly in MAJOR.MINOR.PATCH format.
 * Returns { major, minor, patch, raw } or null if invalid.
 */
export function parseSemver(version) {
  if (typeof version !== "string") return null;
  const trimmed = version.trim();
  const match = SEMVER_REGEX.exec(trimmed);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    raw: trimmed,
  };
}

/**
 * Compares two parsed semver objects or strings.
 * Returns:
 *   1 if v1 > v2
 *  -1 if v1 < v2
 *   0 if v1 === v2
 */
export function compareSemver(v1, v2) {
  const p1 = typeof v1 === "string" ? parseSemver(v1) : v1;
  const p2 = typeof v2 === "string" ? parseSemver(v2) : v2;

  if (!p1 || !p2) {
    throw new Error(`Invalid semver comparison: ${String(v1)} vs ${String(v2)}`);
  }

  if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
  if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
  if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;
  return 0;
}

/**
 * Pure evaluator for installed schema contract version against expected version.
 */
export function evaluateSchemaContract(installedVersion, expectedVersion = EXPECTED_SCHEMA_CONTRACT_VERSION, options = {}) {
  if (installedVersion === null || installedVersion === undefined || installedVersion === "") {
    return {
      ok: false,
      status: CONTRACT_STATUS.MISSING,
      installedVersion: null,
      expectedVersion,
      details: "Marcador de contrato ausente no banco de dados (valor nulo ou vazio)",
    };
  }

  const parsedInstalled = parseSemver(installedVersion);
  if (!parsedInstalled) {
    return {
      ok: false,
      status: CONTRACT_STATUS.INVALID_FORMAT,
      installedVersion,
      expectedVersion,
      details: `Formato de versão do contrato inválido no banco: '${installedVersion}' (esperado semver MAJOR.MINOR.PATCH, ex: 1.0.0)`,
    };
  }

  const parsedExpected = parseSemver(expectedVersion);
  if (!parsedExpected) {
    return {
      ok: false,
      status: CONTRACT_STATUS.INVALID_FORMAT,
      installedVersion,
      expectedVersion,
      details: `Formato de versão esperada inválido no código: '${expectedVersion}' (esperado semver MAJOR.MINOR.PATCH)`,
    };
  }

  const cmp = compareSemver(parsedInstalled, parsedExpected);

  // Exact match requested
  if (options.exactMatch === true) {
    if (cmp !== 0) {
      return {
        ok: false,
        status: CONTRACT_STATUS.OUTDATED,
        installedVersion: parsedInstalled.raw,
        expectedVersion: parsedExpected.raw,
        details: `Versão do contrato semântico do banco (${parsedInstalled.raw}) difere da versão exata esperada (${parsedExpected.raw})`,
      };
    }
  } else {
    // Standard semver compatibility: installed must be at least expected, with same major
    if (cmp < 0) {
      return {
        ok: false,
        status: CONTRACT_STATUS.OUTDATED,
        installedVersion: parsedInstalled.raw,
        expectedVersion: parsedExpected.raw,
        details: `Versão do contrato semântico do banco (${parsedInstalled.raw}) é anterior à mínima esperada pela aplicação (${parsedExpected.raw})`,
      };
    }

    if (parsedInstalled.major !== parsedExpected.major) {
      return {
        ok: false,
        status: CONTRACT_STATUS.OUTDATED,
        installedVersion: parsedInstalled.raw,
        expectedVersion: parsedExpected.raw,
        details: `Versão major do contrato semântico do banco (${parsedInstalled.major}) difere da esperada (${parsedExpected.major})`,
      };
    }
  }

  return {
    ok: true,
    status: CONTRACT_STATUS.CORRECT,
    installedVersion: parsedInstalled.raw,
    expectedVersion: parsedExpected.raw,
    details: `Versão do contrato semântico do banco (${parsedInstalled.raw}) satisfaz a versão esperada (${parsedExpected.raw})`,
  };
}

/**
 * Checks schema contract version in PostgreSQL via node-postgres.
 */
export async function checkSchemaContractViaPg(databaseUrl, options = {}) {
  const ClientClass = options.Client || PgClient;
  let client = options.contractClient || options.client || null;
  let shouldClose = false;
  const expectedVersion = options.expectedVersion || EXPECTED_SCHEMA_CONTRACT_VERSION;

  const queryFn = options.queryFn || options.contractQueryFn;

  try {
    if (!client && !queryFn) {
      const config = options.clientConfig || getPgClientConfig(databaseUrl);
      client = new ClientClass(config);
      shouldClose = true;
      await client.connect();
    }

    const query = queryFn
      ? queryFn
      : async (sql, params) => client.query(sql, params);

    // 1. Check if public.schema_contract table exists
    const tableCheckRes = await query("select to_regclass('public.schema_contract') as regclass;");
    const regclass = tableCheckRes?.rows?.[0]?.regclass;

    if (!regclass) {
      return {
        ok: false,
        status: CONTRACT_STATUS.MISSING,
        installedVersion: null,
        expectedVersion,
        details: "Tabela public.schema_contract não existe no banco de dados",
        method: "pg",
      };
    }

    // 2. Fetch the singleton record (id = 1)
    const sql = `
      select
        contract_version,
        description,
        applied_by,
        created_at,
        updated_at
      from public.schema_contract
      where id = 1
      limit 1;
    `;
    const res = await query(sql);

    if (!res || !Array.isArray(res.rows) || res.rows.length === 0) {
      return {
        ok: false,
        status: CONTRACT_STATUS.MISSING,
        installedVersion: null,
        expectedVersion,
        details: "Registro singleton (id = 1) ausente na tabela public.schema_contract",
        method: "pg",
      };
    }

    const row = res.rows[0];
    const evaluation = evaluateSchemaContract(row.contract_version, expectedVersion, options);

    return {
      ...evaluation,
      row: {
        contract_version: row.contract_version,
        description: row.description,
        applied_by: row.applied_by,
        updated_at: row.updated_at,
      },
      method: "pg",
    };
  } catch (err) {
    return {
      ok: false,
      status: CONTRACT_STATUS.CONNECTION_ERROR,
      installedVersion: null,
      expectedVersion,
      error: redactSecrets(err?.message || String(err), [databaseUrl]),
      details: `Erro de conexão / consulta ao verificar contrato do schema: ${redactSecrets(err?.message || String(err), [databaseUrl])}`,
      method: "pg",
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

/**
 * Checks schema contract version via PostgREST REST API (optional fallback for non-strict/preview environments).
 */
export async function checkSchemaContractViaRest(baseUrl, apiKey, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const expectedVersion = options.expectedVersion || EXPECTED_SCHEMA_CONTRACT_VERSION;
  const url = `${baseUrl.replace(/\/+$/, "")}/rest/v1/schema_contract?id=eq.1&select=contract_version,description,applied_by,updated_at`;
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  try {
    const response = await fetchFn(url, { method: "GET", headers });
    const httpStatus = response.status;

    if (httpStatus === 404) {
      return {
        ok: false,
        status: CONTRACT_STATUS.MISSING,
        installedVersion: null,
        expectedVersion,
        httpStatus,
        details: "Rota /rest/v1/schema_contract não encontrada (404 / PGRST202)",
        method: "rest",
      };
    }

    if (httpStatus === 401 || httpStatus === 403) {
      return {
        ok: false,
        status: CONTRACT_STATUS.CONNECTION_ERROR,
        installedVersion: null,
        expectedVersion,
        httpStatus,
        details: `Permissão negada ao consultar /rest/v1/schema_contract (HTTP ${httpStatus})`,
        method: "rest",
      };
    }

    if (httpStatus < 200 || httpStatus >= 300) {
      return {
        ok: false,
        status: CONTRACT_STATUS.CONNECTION_ERROR,
        installedVersion: null,
        expectedVersion,
        httpStatus,
        details: `Erro HTTP ${httpStatus} ao consultar /rest/v1/schema_contract`,
        method: "rest",
      };
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      return {
        ok: false,
        status: CONTRACT_STATUS.MISSING,
        installedVersion: null,
        expectedVersion,
        details: "Nenhum registro encontrado em public.schema_contract (id = 1)",
        method: "rest",
      };
    }

    const row = data[0];
    const evaluation = evaluateSchemaContract(row?.contract_version, expectedVersion, options);
    return {
      ...evaluation,
      row,
      method: "rest",
    };
  } catch (err) {
    return {
      ok: false,
      status: CONTRACT_STATUS.CONNECTION_ERROR,
      installedVersion: null,
      expectedVersion,
      error: redactSecrets(err?.message || String(err), [apiKey]),
      details: `Erro de rede/REST ao consultar schema_contract: ${redactSecrets(err?.message || String(err), [apiKey])}`,
      method: "rest",
    };
  }
}
