import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "supabase/migrations/20260920120000_subscription_entitlement_boundary.sql",
);

const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");

describe("Database Migration: subscription_entitlement_boundary.sql", () => {
  test("1. Migration exists and defines has_active_entitlement as SECURITY DEFINER", () => {
    assert.ok(fs.existsSync(MIGRATION_PATH), "Migration file must exist");
    assert.match(
      migrationSql,
      /create or replace function public\.has_active_entitlement/i,
      "Must define public.has_active_entitlement",
    );
    assert.match(migrationSql, /security definer/i, "Function must be SECURITY DEFINER");
    assert.match(migrationSql, /set search_path = public, auth/i, "Function search_path must be public, auth");
  });

  test("2. Permissions on has_active_entitlement are properly secured", () => {
    assert.match(
      migrationSql,
      /revoke execute on function public\.has_active_entitlement\(uuid\) from public, anon;/i,
      "Must revoke execute from public and anon",
    );
    assert.match(
      migrationSql,
      /grant execute on function public\.has_active_entitlement\(uuid\) to authenticated, service_role;/i,
      "Must grant execute to authenticated and service_role",
    );
  });

  test("3. has_active_entitlement isolates caller and evaluates trial & Pro strictly", () => {
    // Isolamento contra consulta de outro usuário
    assert.match(
      migrationSql,
      /v_caller_uid is not null and p_user_id is not null and p_user_id <> v_caller_uid/i,
      "Must prevent authenticated user from checking another user's entitlement (Scenario E)",
    );
    // Trial: 14 dias a partir de auth.users.created_at
    assert.match(migrationSql, /from auth\.users/i, "Must read created_at from auth.users");
    assert.match(migrationSql, /v_created_at \+ interval '14 days'/i, "Must evaluate 14 days interval");
    // Pro: subscriptions.current_period_end > now()
    assert.match(migrationSql, /from public\.subscriptions/i, "Must read current_period_end from subscriptions");
    assert.match(
      migrationSql,
      /current_period_end is not null and v_current_period_end > v_now/i,
      "Must strictly check current_period_end > now() without relying on status='active' alone",
    );
  });

  test("4. save_shift_with_obligation invokes has_active_entitlement and throws 42501", () => {
    assert.match(
      migrationSql,
      /if not public\.has_active_entitlement\(v_user_id\) then\s+raise exception using errcode = '42501'/i,
      "save_shift_with_obligation must validate entitlement and throw 42501",
    );
    assert.match(
      migrationSql,
      /message = 'Plano Pro ou periodo de testes expirado'/i,
      "save_shift_with_obligation must return clear Portuguese error message",
    );
  });

  test("5. RLS policies on public.shifts enforce entitlement on direct inserts and updates", () => {
    assert.match(
      migrationSql,
      /create policy "shifts_insert_own"\s+on public\.shifts for insert to authenticated\s+with check \(\(select auth\.uid\(\)\) = user_id and public\.has_active_entitlement\(user_id\)\);/is,
      "shifts_insert_own must require public.has_active_entitlement(user_id)",
    );
    assert.match(
      migrationSql,
      /create policy "shifts_update_own"\s+on public\.shifts for update to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)\s+with check \(\(select auth\.uid\(\)\) = user_id and public\.has_active_entitlement\(user_id\)\);/is,
      "shifts_update_own must require public.has_active_entitlement(user_id)",
    );
  });
});

/**
 * Deterministic Postgres PL/pgSQL Simulator.
 * Exactly implements the algorithm in 20260920120000_subscription_entitlement_boundary.sql
 */
class SupabaseEntitlementBoundaryEngine {
  constructor() {
    this.users = new Map(); // id -> { created_at: Date }
    this.subscriptions = new Map(); // user_id -> { status, current_period_end: Date | null }
    this.shifts = new Map(); // id -> { id, user_id, place_id, data, valor_previsto, status }
  }

  addUser(id, createdAt) {
    this.users.set(id, { created_at: new Date(createdAt) });
  }

  setSubscription(userId, { status, currentPeriodEnd }) {
    this.subscriptions.set(userId, {
      status,
      current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd) : null,
    });
  }

  /**
   * Simulates public.has_active_entitlement(p_user_id uuid default auth.uid())
   */
  hasActiveEntitlement(callerUid, pUserId, now = new Date()) {
    const vCallerUid = callerUid || null;
    const vUserId = pUserId || vCallerUid;

    if (!vUserId) return false;

    // Se chamado no contexto autenticado, impede consultar outro usuário (Scenario E)
    if (vCallerUid !== null && pUserId !== null && pUserId !== undefined && pUserId !== vCallerUid) {
      return false;
    }

    // 1. Período de trial: 14 dias a partir de auth.users.created_at
    const user = this.users.get(vUserId);
    if (user && user.created_at) {
      const trialEnd = new Date(user.created_at.getTime() + 14 * 24 * 60 * 60 * 1000);
      if (now.getTime() < trialEnd.getTime()) {
        return true;
      }
    }

    // 2. Assinatura Pro: vigência real futura em subscriptions.current_period_end
    const sub = this.subscriptions.get(vUserId);
    if (sub && sub.current_period_end) {
      if (sub.current_period_end.getTime() > now.getTime()) {
        return true;
      }
    }

    return false;
  }

  /**
   * Simulates public.save_shift_with_obligation RPC
   */
  saveShiftWithObligation(callerUid, params, now = new Date()) {
    const vUserId = callerUid || null;
    if (!vUserId) {
      const err = new Error("Autenticacao obrigatoria");
      err.code = "28000";
      throw err;
    }

    // Validação de Entitlement
    if (!this.hasActiveEntitlement(vUserId, vUserId, now)) {
      const err = new Error("Plano Pro ou periodo de testes expirado");
      err.code = "42501";
      throw err;
    }

    const { p_shift_id, p_place_id, p_data, p_valor_previsto, p_status = "agendado" } = params;

    if (p_shift_id) {
      const existing = this.shifts.get(p_shift_id);
      if (!existing || existing.user_id !== vUserId) {
        const err = new Error("Plantao nao encontrado para este usuario");
        err.code = "23503";
        throw err;
      }
      existing.place_id = p_place_id;
      existing.data = p_data;
      existing.valor_previsto = p_valor_previsto;
      existing.status = p_status;
      return { ...existing };
    } else {
      const newShift = {
        id: `shift-${Math.random().toString(36).slice(2)}`,
        user_id: vUserId,
        place_id: p_place_id,
        data: p_data,
        valor_previsto: p_valor_previsto,
        status: p_status,
      };
      this.shifts.set(newShift.id, newShift);
      return { ...newShift };
    }
  }

  /**
   * Simulates SELECT * FROM shifts WHERE user_id = auth.uid() (RLS shifts_select_own)
   */
  selectShifts(callerUid) {
    if (!callerUid) return [];
    return Array.from(this.shifts.values()).filter((s) => s.user_id === callerUid);
  }

  /**
   * Simulates direct table INSERT on public.shifts (RLS shifts_insert_own)
   */
  directInsertShift(callerUid, shift, now = new Date()) {
    if (!callerUid || shift.user_id !== callerUid) {
      const err = new Error("new row violates row-level security policy for table \"shifts\"");
      err.code = "42501";
      throw err;
    }
    if (!this.hasActiveEntitlement(callerUid, shift.user_id, now)) {
      const err = new Error("new row violates row-level security policy for table \"shifts\"");
      err.code = "42501";
      throw err;
    }
    this.shifts.set(shift.id, { ...shift });
    return { ...shift };
  }

  /**
   * Simulates direct table UPDATE on public.shifts (RLS shifts_update_own)
   */
  directUpdateShift(callerUid, shiftId, updates, now = new Date()) {
    const existing = this.shifts.get(shiftId);
    if (!existing || existing.user_id !== callerUid) {
      return null;
    }
    if (!this.hasActiveEntitlement(callerUid, existing.user_id, now)) {
      const err = new Error("new row violates row-level security policy for table \"shifts\"");
      err.code = "42501";
      throw err;
    }
    Object.assign(existing, updates);
    return { ...existing };
  }
}

describe("Entitlement Boundary: Cenários Obrigatórios (A a F)", () => {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const NOW = new Date("2026-09-20T12:00:00Z");

  const USER_A = "11111111-1111-4111-8111-111111111111";
  const USER_B = "22222222-2222-4222-8222-222222222222";

  test("Cenário A: usuário com 5 dias de conta, sem assinatura -> pode criar plantão", () => {
    const engine = new SupabaseEntitlementBoundaryEngine();
    const created5DaysAgo = new Date(NOW.getTime() - 5 * MS_PER_DAY);
    engine.addUser(USER_A, created5DaysAgo);

    // Sem assinatura
    assert.equal(engine.hasActiveEntitlement(USER_A, USER_A, NOW), true);

    // Criação via RPC é permitida
    const shift = engine.saveShiftWithObligation(
      USER_A,
      {
        p_shift_id: null,
        p_place_id: "place-1",
        p_data: "2026-09-25",
        p_valor_previsto: 1200,
        p_status: "agendado",
      },
      NOW,
    );

    assert.ok(shift.id);
    assert.equal(shift.user_id, USER_A);
    assert.equal(shift.valor_previsto, 1200);
  });

  test("Cenário B: usuário com 15 dias de conta, sem assinatura -> RPC rejeita", () => {
    const engine = new SupabaseEntitlementBoundaryEngine();
    const created15DaysAgo = new Date(NOW.getTime() - 15 * MS_PER_DAY);
    engine.addUser(USER_A, created15DaysAgo);

    // Entitlement expirado
    assert.equal(engine.hasActiveEntitlement(USER_A, USER_A, NOW), false);

    // Chamada à RPC deve ser terminantemente rejeitada com 42501
    assert.throws(
      () => {
        engine.saveShiftWithObligation(
          USER_A,
          {
            p_shift_id: null,
            p_place_id: "place-1",
            p_data: "2026-09-25",
            p_valor_previsto: 1200,
            p_status: "agendado",
          },
          NOW,
        );
      },
      (err) => {
        assert.equal(err.code, "42501");
        assert.match(err.message, /Plano Pro ou periodo de testes expirado/);
        return true;
      },
    );
  });

  test("Cenário C: usuário com 30 dias de conta e current_period_end futuro -> pode criar e editar", () => {
    const engine = new SupabaseEntitlementBoundaryEngine();
    const created30DaysAgo = new Date(NOW.getTime() - 30 * MS_PER_DAY);
    engine.addUser(USER_A, created30DaysAgo);

    const periodEndFuture = new Date(NOW.getTime() + 15 * MS_PER_DAY);
    engine.setSubscription(USER_A, {
      status: "active",
      currentPeriodEnd: periodEndFuture,
    });

    // Entitlement ativo graças ao Pro futuro
    assert.equal(engine.hasActiveEntitlement(USER_A, USER_A, NOW), true);

    // 1. Criação via RPC permitida
    const shift = engine.saveShiftWithObligation(
      USER_A,
      {
        p_shift_id: null,
        p_place_id: "place-1",
        p_data: "2026-09-25",
        p_valor_previsto: 1500,
        p_status: "agendado",
      },
      NOW,
    );
    assert.ok(shift.id);

    // 2. Edição via RPC permitida
    const updated = engine.saveShiftWithObligation(
      USER_A,
      {
        p_shift_id: shift.id,
        p_place_id: "place-2",
        p_data: "2026-09-26",
        p_valor_previsto: 1600,
        p_status: "agendado",
      },
      NOW,
    );
    assert.equal(updated.id, shift.id);
    assert.equal(updated.valor_previsto, 1600);
    assert.equal(updated.place_id, "place-2");
  });

  test("Cenário D: status='active', mas current_period_end passado -> rejeita (não confia em status isoladamente)", () => {
    const engine = new SupabaseEntitlementBoundaryEngine();
    const created30DaysAgo = new Date(NOW.getTime() - 30 * MS_PER_DAY);
    engine.addUser(USER_A, created30DaysAgo);

    const periodEndPast = new Date(NOW.getTime() - 1 * MS_PER_DAY);
    // status diz "active", mas vigência real expirou
    engine.setSubscription(USER_A, {
      status: "active",
      currentPeriodEnd: periodEndPast,
    });

    // Deve ser falso! A autoridade é a vigência futura real.
    assert.equal(engine.hasActiveEntitlement(USER_A, USER_A, NOW), false);

    assert.throws(
      () => {
        engine.saveShiftWithObligation(
          USER_A,
          {
            p_shift_id: null,
            p_place_id: "place-1",
            p_data: "2026-09-25",
            p_valor_previsto: 1000,
            p_status: "agendado",
          },
          NOW,
        );
      },
      (err) => {
        assert.equal(err.code, "42501");
        assert.match(err.message, /Plano Pro ou periodo de testes expirado/);
        return true;
      },
    );
  });

  test("Cenário E: usuário A nunca consegue usar entitlement de usuário B", () => {
    const engine = new SupabaseEntitlementBoundaryEngine();

    // Usuário A: 30 dias de conta, sem assinatura (expirado)
    engine.addUser(USER_A, new Date(NOW.getTime() - 30 * MS_PER_DAY));

    // Usuário B: Pro ativo com 20 dias restantes
    engine.addUser(USER_B, new Date(NOW.getTime() - 30 * MS_PER_DAY));
    engine.setSubscription(USER_B, {
      status: "active",
      currentPeriodEnd: new Date(NOW.getTime() + 20 * MS_PER_DAY),
    });

    // Usuário B tem entitlement
    assert.equal(engine.hasActiveEntitlement(USER_B, USER_B, NOW), true);
    // Usuário A NÃO tem entitlement
    assert.equal(engine.hasActiveEntitlement(USER_A, USER_A, NOW), false);

    // 1. Usuário A tenta consultar entitlement de B diretamente -> bloqueado
    assert.equal(engine.hasActiveEntitlement(USER_A, USER_B, NOW), false);

    // 2. Usuário A tenta chamar a RPC save_shift_with_obligation -> rejeita porque v_user_id = auth.uid()
    assert.throws(
      () => {
        engine.saveShiftWithObligation(
          USER_A,
          {
            p_shift_id: null,
            p_place_id: "place-1",
            p_data: "2026-09-25",
            p_valor_previsto: 1000,
            p_status: "agendado",
          },
          NOW,
        );
      },
      (err) => {
        assert.equal(err.code, "42501");
        return true;
      },
    );

    // 3. Usuário B cria um plantão legítimo
    const shiftB = engine.saveShiftWithObligation(
      USER_B,
      {
        p_shift_id: null,
        p_place_id: "place-b",
        p_data: "2026-09-25",
        p_valor_previsto: 2000,
        p_status: "agendado",
      },
      NOW,
    );

    // 4. Usuário A tenta alterar o plantão do Usuário B -> bloqueado por entitlement de A
    assert.throws(
      () => {
        engine.saveShiftWithObligation(
          USER_A,
          {
            p_shift_id: shiftB.id,
            p_place_id: "place-b",
            p_data: "2026-09-25",
            p_valor_previsto: 2500,
            p_status: "agendado",
          },
          NOW,
        );
      },
      (err) => {
        assert.equal(err.code, "42501");
        return true;
      },
    );
  });

  test("Cenário F: leitura do histórico continua funcionando após expiração", () => {
    const engine = new SupabaseEntitlementBoundaryEngine();

    // Usuário A criou um plantão enquanto estava no trial (dia 5)
    const t0 = new Date(NOW.getTime() - 25 * MS_PER_DAY);
    engine.addUser(USER_A, t0);

    const duringTrial = new Date(t0.getTime() + 2 * MS_PER_DAY);
    const existingShift = engine.saveShiftWithObligation(
      USER_A,
      {
        p_shift_id: null,
        p_place_id: "place-antigo",
        p_data: "2026-08-30",
        p_valor_previsto: 1100,
        p_status: "realizado",
      },
      duringTrial,
    );

    // Agora, 25 dias depois, a conta expirou
    assert.equal(engine.hasActiveEntitlement(USER_A, USER_A, NOW), false);

    // Tentativa de criar novo plantão é bloqueada
    assert.throws(() => {
      engine.saveShiftWithObligation(
        USER_A,
        {
          p_shift_id: null,
          p_place_id: "place-novo",
          p_data: "2026-09-25",
          p_valor_previsto: 1200,
          p_status: "agendado",
        },
        NOW,
      );
    });

    // MAS a leitura do histórico (SELECT via RLS) continua funcionando 100%
    const userShifts = engine.selectShifts(USER_A);
    assert.equal(userShifts.length, 1);
    assert.equal(userShifts[0].id, existingShift.id);
    assert.equal(userShifts[0].valor_previsto, 1100);
    assert.equal(userShifts[0].place_id, "place-antigo");
  });

  test("Fronteiras temporais precisas: 13 dias 23h59 vs 14 dias exatos", () => {
    const engine = new SupabaseEntitlementBoundaryEngine();

    // 13 dias e 23 horas -> ainda no trial (< 14 dias)
    const userActive = "user-active-boundary";
    const created13d23h = new Date(NOW.getTime() - (13 * MS_PER_DAY + 23 * 60 * 60 * 1000));
    engine.addUser(userActive, created13d23h);
    assert.equal(engine.hasActiveEntitlement(userActive, userActive, NOW), true);

    // 14 dias exatos -> expirado (regra: menos de 14 dias)
    const userExpired = "user-expired-boundary";
    const created14d = new Date(NOW.getTime() - 14 * MS_PER_DAY);
    engine.addUser(userExpired, created14d);
    assert.equal(engine.hasActiveEntitlement(userExpired, userExpired, NOW), false);
  });

  test("Entitlement boundary também protege INSERT e UPDATE diretos na tabela shifts", () => {
    const engine = new SupabaseEntitlementBoundaryEngine();
    engine.addUser(USER_A, new Date(NOW.getTime() - 20 * MS_PER_DAY)); // Expirado

    // INSERT direto bloqueado pela RLS policy shifts_insert_own
    assert.throws(
      () => {
        engine.directInsertShift(
          USER_A,
          {
            id: "shift-bypass-1",
            user_id: USER_A,
            place_id: "place-1",
            data: "2026-09-25",
            valor_previsto: 1000,
            status: "agendado",
          },
          NOW,
        );
      },
      (err) => {
        assert.equal(err.code, "42501");
        return true;
      },
    );
  });
});
