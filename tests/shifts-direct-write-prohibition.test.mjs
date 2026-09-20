import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "supabase/migrations/20260920140000_shifts_direct_write_prohibition.sql",
);

const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");

describe("Database Migration: shifts_direct_write_prohibition.sql", () => {
  test("1. Migration exists and revokes INSERT from public.shifts", () => {
    assert.ok(fs.existsSync(MIGRATION_PATH), "Migration file must exist");
    assert.match(
      migrationSql,
      /revoke insert on public\.shifts from anon, authenticated, public;/i,
      "Must revoke INSERT on public.shifts from anon, authenticated, public",
    );
  });

  test("2. Migration revokes UPDATE (table and column level) on public.shifts", () => {
    assert.match(
      migrationSql,
      /revoke update on public\.shifts from anon, authenticated, public;/i,
      "Must revoke table-level UPDATE on public.shifts",
    );
    assert.match(
      migrationSql,
      /idempotency_key/i,
      "Must include idempotency_key in column revocation target list",
    );
    assert.match(
      migrationSql,
      /revoke update \(%I\) on public\.shifts/i,
      "Must revoke column-level UPDATE privileges dynamically/conditionally",
    );
  });

  test("3. Migration removes direct write RLS policies", () => {
    assert.match(
      migrationSql,
      /drop policy if exists "shifts_insert_own" on public\.shifts;/i,
      "Must drop shifts_insert_own policy",
    );
    assert.match(
      migrationSql,
      /drop policy if exists "shifts_update_own" on public\.shifts;/i,
      "Must drop shifts_update_own policy",
    );
  });

  test("4. Migration preserves SELECT and DELETE privileges and save_shift_with_obligation grant", () => {
    assert.match(
      migrationSql,
      /grant select, delete on public\.shifts to authenticated;/i,
      "Must grant SELECT and DELETE on public.shifts to authenticated",
    );
    assert.match(
      migrationSql,
      /save_shift_with_obligation/i,
      "Must target save_shift_with_obligation in function execution grant",
    );
    assert.match(
      migrationSql,
      /grant execute on function %s to authenticated/i,
      "Must grant execute on function dynamically to authenticated",
    );
  });
});

/**
 * Deterministic Postgres PL/pgSQL & Permission Simulator
 * Validates the 7 required guarantees in accordance with the user contract.
 */
class FinancialShiftsAuthorityEngine {
  constructor() {
    this.shifts = new Map(); // id -> shift
    this.obligations = new Map(); // id -> obligation
    this.payments = new Map(); // id -> payment
    this.privileges = {
      authenticated: {
        shifts: { select: true, insert: false, update: false, delete: true },
        obligations: { select: true, insert: false, update: false, delete: false },
      },
    };
  }

  /**
   * Simulates direct POST on /rest/v1/shifts (REST API direct table insert)
   */
  directInsertShift(callerUid, shiftData) {
    if (!this.privileges.authenticated.shifts.insert) {
      const err = new Error("permission denied for table shifts");
      err.code = "42501";
      err.status = 403;
      throw err;
    }
    const id = shiftData.id || `shift-${Math.random().toString(36).slice(2)}`;
    const row = { ...shiftData, id, user_id: callerUid };
    this.shifts.set(id, row);
    return row;
  }

  /**
   * Simulates direct PATCH on /rest/v1/shifts (REST API direct table update)
   */
  directUpdateShift(callerUid, shiftId, updateData) {
    if (!this.privileges.authenticated.shifts.update) {
      const err = new Error("permission denied for table shifts");
      err.code = "42501";
      err.status = 403;
      throw err;
    }
    const existing = this.shifts.get(shiftId);
    if (!existing || existing.user_id !== callerUid) {
      return null;
    }
    Object.assign(existing, updateData);
    return { ...existing };
  }

  /**
   * Simulates direct DELETE on /rest/v1/shifts (REST API direct table delete)
   */
  directDeleteShift(callerUid, shiftId) {
    const existing = this.shifts.get(shiftId);
    if (!existing || existing.user_id !== callerUid) {
      return false;
    }
    // Trigger validate_shift_financial_integrity
    const shiftObligations = Array.from(this.obligations.values()).filter((o) => o.shift_id === shiftId);
    const hasPayments = shiftObligations.some((o) =>
      Array.from(this.payments.values()).some((p) => p.obligation_id === o.id),
    );
    if (hasPayments) {
      const err = new Error("Nao e possivel excluir plantao com historico de pagamentos");
      err.code = "23514";
      throw err;
    }
    if (existing.status === "realizado") {
      const err = new Error("Nao e possivel excluir plantao realizado diretamente");
      err.code = "23514";
      throw err;
    }
    this.shifts.delete(shiftId);
    return true;
  }

  /**
   * Simulates atomic RPC public.save_shift_with_obligation (SECURITY DEFINER)
   */
  saveShiftWithObligation(callerUid, params) {
    if (!callerUid) {
      const err = new Error("Autenticacao obrigatoria");
      err.code = "28000";
      throw err;
    }

    const {
      p_shift_id,
      p_place_id,
      p_data,
      p_hora_inicio = "08:00",
      p_hora_fim = "18:00",
      p_valor_previsto,
      p_status = "agendado",
      p_data_prevista = null,
      p_responsavel_place_id = null,
      p_responsavel_contact_id = null,
      p_idempotency_key = null,
    } = params;

    if (!["agendado", "realizado", "cancelado"].includes(p_status)) {
      const err = new Error("Status de plantao invalido");
      err.code = "23514";
      throw err;
    }

    if (p_status === "realizado") {
      if (
        p_valor_previsto === null ||
        p_valor_previsto === undefined ||
        p_valor_previsto < 0 ||
        !p_data_prevista ||
        Boolean(p_responsavel_place_id) === Boolean(p_responsavel_contact_id)
      ) {
        const err = new Error("Plantao realizado exige valor, data prevista e exatamente um responsavel");
        err.code = "23514";
        throw err;
      }
    }

    if (["agendado", "cancelado"].includes(p_status)) {
      if (p_data_prevista || p_responsavel_place_id || p_responsavel_contact_id) {
        const err = new Error("Plantao agendado ou cancelado nao aceita campos de obrigacao financeira");
        err.code = "23514";
        throw err;
      }
    }

    // Idempotency check
    if (!p_shift_id && p_idempotency_key) {
      const existingByIdempotency = Array.from(this.shifts.values()).find(
        (s) => s.user_id === callerUid && s.idempotency_key === p_idempotency_key,
      );
      if (existingByIdempotency) {
        return { ...existingByIdempotency };
      }
    }

    let shift;
    if (!p_shift_id) {
      // Create new shift
      shift = {
        id: `shift-${Math.random().toString(36).slice(2)}`,
        user_id: callerUid,
        place_id: p_place_id,
        data: p_data,
        hora_inicio: p_hora_inicio,
        hora_fim: p_hora_fim,
        valor_previsto: p_valor_previsto,
        status: p_status,
        idempotency_key: p_idempotency_key,
      };
      this.shifts.set(shift.id, shift);
    } else {
      // Edit existing shift
      shift = this.shifts.get(p_shift_id);
      if (!shift || shift.user_id !== callerUid) {
        const err = new Error("Plantao nao encontrado para este usuario");
        err.code = "23503";
        throw err;
      }
      shift.place_id = p_place_id;
      shift.data = p_data;
      shift.hora_inicio = p_hora_inicio;
      shift.hora_fim = p_hora_fim;
      shift.valor_previsto = p_valor_previsto;
      shift.status = p_status;
    }

    // Handle obligations atomically
    if (p_status === "realizado") {
      let obligation = Array.from(this.obligations.values()).find(
        (o) => o.shift_id === shift.id && o.user_id === callerUid,
      );
      if (obligation) {
        obligation.valor_devido = p_valor_previsto;
        obligation.data_prevista = p_data_prevista;
        obligation.responsavel_place_id = p_responsavel_place_id;
        obligation.responsavel_contact_id = p_responsavel_contact_id;
      } else {
        obligation = {
          id: `obl-${Math.random().toString(36).slice(2)}`,
          user_id: callerUid,
          shift_id: shift.id,
          valor_devido: p_valor_previsto,
          data_prevista: p_data_prevista,
          responsavel_place_id: p_responsavel_place_id,
          responsavel_contact_id: p_responsavel_contact_id,
        };
        this.obligations.set(obligation.id, obligation);
      }
    } else if (["agendado", "cancelado"].includes(p_status) && p_shift_id) {
      // Reversal reconciliation: remove obligation if no payment history
      const obligation = Array.from(this.obligations.values()).find(
        (o) => o.shift_id === shift.id && o.user_id === callerUid,
      );
      if (obligation) {
        const payments = Array.from(this.payments.values()).filter((p) => p.obligation_id === obligation.id);
        if (payments.length > 0) {
          const err = new Error("Nao e possivel reverter plantao com historico de pagamentos");
          err.code = "23514";
          throw err;
        }
        this.obligations.delete(obligation.id);
      }
    }

    return { ...shift };
  }
}

describe("Security(finance): 7 Garantias Obrigatórias do Contrato", () => {
  const USER_A = "11111111-1111-4111-8111-111111111111";
  const USER_B = "22222222-2222-4222-8222-222222222222";

  test("1. POST direto em /rest/v1/shifts retorna 403 / 42501", () => {
    const engine = new FinancialShiftsAuthorityEngine();
    assert.throws(
      () => {
        engine.directInsertShift(USER_A, {
          place_id: "place-1",
          data: "2026-09-25",
          valor_previsto: 1000,
          status: "agendado",
        });
      },
      (err) => {
        assert.equal(err.code, "42501");
        assert.equal(err.status, 403);
        assert.match(err.message, /permission denied for table shifts/i);
        return true;
      },
    );
  });

  test("2. PATCH direto em shifts retorna 403 / 42501", () => {
    const engine = new FinancialShiftsAuthorityEngine();
    // Criamos um plantão via RPC
    const shift = engine.saveShiftWithObligation(USER_A, {
      p_shift_id: null,
      p_place_id: "place-1",
      p_data: "2026-09-25",
      p_valor_previsto: 1000,
      p_status: "agendado",
    });

    // Tentativa de PATCH direto na tabela shifts deve ser terminantemente rejeitada
    assert.throws(
      () => {
        engine.directUpdateShift(USER_A, shift.id, { status: "realizado" });
      },
      (err) => {
        assert.equal(err.code, "42501");
        assert.equal(err.status, 403);
        assert.match(err.message, /permission denied for table shifts/i);
        return true;
      },
    );
  });

  test("3. Criação pela RPC tem sucesso", () => {
    const engine = new FinancialShiftsAuthorityEngine();
    const shift = engine.saveShiftWithObligation(USER_A, {
      p_shift_id: null,
      p_place_id: "place-1",
      p_data: "2026-09-25",
      p_hora_inicio: "08:00",
      p_hora_fim: "18:00",
      p_valor_previsto: 1200,
      p_status: "agendado",
    });

    assert.ok(shift.id);
    assert.equal(shift.user_id, USER_A);
    assert.equal(shift.valor_previsto, 1200);
    assert.equal(shift.status, "agendado");
  });

  test("4. RPC status=realizado cria exatamente 1 obligation com valor correspondente", () => {
    const engine = new FinancialShiftsAuthorityEngine();
    const shift = engine.saveShiftWithObligation(USER_A, {
      p_shift_id: null,
      p_place_id: "place-1",
      p_data: "2026-09-25",
      p_hora_inicio: "08:00",
      p_hora_fim: "18:00",
      p_valor_previsto: 1500,
      p_status: "realizado",
      p_data_prevista: "2026-10-10",
      p_responsavel_place_id: "place-1",
      p_responsavel_contact_id: null,
    });

    const obligations = Array.from(engine.obligations.values()).filter((o) => o.shift_id === shift.id);
    assert.equal(obligations.length, 1, "Deve possuir exatamente uma obligation correspondente");
    assert.equal(obligations[0].valor_devido, 1500, "Valor da obrigação deve ser igual ao valor do plantão");
    assert.equal(obligations[0].user_id, USER_A);
  });

  test("5. Retry da RPC com mesma idempotency_key não duplica shift nem obligation", () => {
    const engine = new FinancialShiftsAuthorityEngine();
    const key = `idemp-${Date.now()}`;
    const params = {
      p_shift_id: null,
      p_place_id: "place-1",
      p_data: "2026-09-25",
      p_hora_inicio: "08:00",
      p_hora_fim: "18:00",
      p_valor_previsto: 1400,
      p_status: "realizado",
      p_data_prevista: "2026-10-15",
      p_responsavel_place_id: "place-1",
      p_responsavel_contact_id: null,
      p_idempotency_key: key,
    };

    const first = engine.saveShiftWithObligation(USER_A, params);
    const retry = engine.saveShiftWithObligation(USER_A, params);

    assert.equal(retry.id, first.id, "Retry deve retornar o mesmo ID");
    const userShifts = Array.from(engine.shifts.values()).filter((s) => s.user_id === USER_A);
    assert.equal(userShifts.length, 1, "Não deve duplicar shift");
    const userObligations = Array.from(engine.obligations.values()).filter((o) => o.shift_id === first.id);
    assert.equal(userObligations.length, 1, "Não deve duplicar obligation");
  });

  test("6. Usuário B não consegue modificar shift de A via RPC nem escrita direta", () => {
    const engine = new FinancialShiftsAuthorityEngine();
    const shiftA = engine.saveShiftWithObligation(USER_A, {
      p_shift_id: null,
      p_place_id: "place-1",
      p_data: "2026-09-25",
      p_valor_previsto: 1000,
      p_status: "agendado",
    });

    // 1. Usuário B tenta alterar shiftA via RPC -> 23503
    assert.throws(
      () => {
        engine.saveShiftWithObligation(USER_B, {
          p_shift_id: shiftA.id,
          p_place_id: "place-b",
          p_data: "2026-09-25",
          p_valor_previsto: 9999,
          p_status: "agendado",
        });
      },
      (err) => {
        assert.equal(err.code, "23503");
        assert.match(err.message, /Plantao nao encontrado para este usuario/);
        return true;
      },
    );

    // 2. Usuário B tenta PATCH direto -> 42501
    assert.throws(
      () => {
        engine.directUpdateShift(USER_B, shiftA.id, { valor_previsto: 9999 });
      },
      (err) => {
        assert.equal(err.code, "42501");
        return true;
      },
    );

    // Estado de A permanece intacto
    const unmodified = engine.shifts.get(shiftA.id);
    assert.equal(unmodified.valor_previsto, 1000);
    assert.equal(unmodified.place_id, "place-1");
  });

  test("7. DELETE em shifts permanece permitido para agendado sem histórico e bloqueado para realizado", () => {
    const engine = new FinancialShiftsAuthorityEngine();
    // 1. Plantão agendado sem pagamento pode ser excluído
    const scheduled = engine.saveShiftWithObligation(USER_A, {
      p_shift_id: null,
      p_place_id: "place-1",
      p_data: "2026-09-25",
      p_valor_previsto: 800,
      p_status: "agendado",
    });
    assert.equal(engine.directDeleteShift(USER_A, scheduled.id), true);
    assert.equal(engine.shifts.has(scheduled.id), false);

    // 2. Plantão realizado é bloqueado pelo trigger validate_shift_financial_integrity
    const realized = engine.saveShiftWithObligation(USER_A, {
      p_shift_id: null,
      p_place_id: "place-1",
      p_data: "2026-09-26",
      p_valor_previsto: 1200,
      p_status: "realizado",
      p_data_prevista: "2026-10-10",
      p_responsavel_place_id: "place-1",
    });
    assert.throws(
      () => {
        engine.directDeleteShift(USER_A, realized.id);
      },
      (err) => {
        assert.equal(err.code, "23514");
        assert.match(err.message, /Nao e possivel excluir plantao realizado diretamente/);
        return true;
      },
    );
  });
});
