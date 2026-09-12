import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDashboardAlerts,
  getSaoPauloDateIso,
  addDaysToIso,
  calculateDaysDiff,
} from "../src/lib/dashboard/alerts.ts";

test("getSaoPauloDateIso formata data no fuso America/Sao_Paulo", () => {
  // 2026-09-12T01:30:00Z em UTC é 2026-09-11T22:30:00-03:00 em São Paulo
  const utcNight = new Date("2026-09-12T01:30:00Z");
  assert.equal(getSaoPauloDateIso(utcNight), "2026-09-11");

  // 2026-09-12T15:00:00Z em UTC é 2026-09-12T12:00:00-03:00 em São Paulo
  const utcDay = new Date("2026-09-12T15:00:00Z");
  assert.equal(getSaoPauloDateIso(utcDay), "2026-09-12");
});

test("addDaysToIso adiciona dias corretamente", () => {
  assert.equal(addDaysToIso("2026-09-05", 7), "2026-09-12");
  assert.equal(addDaysToIso("2026-02-27", 3), "2026-03-02");
});

test("calculateDaysDiff calcula diferenca de dias inteiros", () => {
  assert.equal(calculateDaysDiff("2026-09-07", "2026-09-07"), 0);
  assert.equal(calculateDaysDiff("2026-09-05", "2026-09-07"), -2);
  assert.equal(calculateDaysDiff("2026-09-14", "2026-09-07"), 7);
});

test("computeDashboardAlerts com dados vazios retorna zeros e sem alertas", () => {
  const summary = computeDashboardAlerts({
    shifts: [],
    obligations: [],
    now: "2026-09-12",
  });

  assert.equal(summary.overdueCount, 0);
  assert.equal(summary.overdueAmount, 0);
  assert.equal(summary.upcomingCount, 0);
  assert.equal(summary.upcomingAmount, 0);
  assert.equal(summary.topOverdue, null);
  assert.equal(summary.topUpcoming, null);
  assert.equal(summary.hasAlerts, false);
});

test("plantao quitado (saldo = 0) nunca gera alerta de atraso ou vencimento", () => {
  const shifts = [
    { id: "s1", status: "realizado", place_id: "p1", data: "2026-08-10", hora_inicio: "07:00", hora_fim: "19:00" },
  ];
  const obligations = [
    {
      id: "o1",
      shift_id: "s1",
      valor_devido: 1500,
      saldo: 0, // quitado integralmente
      data_prevista: "2026-08-20", // no passado
      responsavel_place_id: "p1",
      responsavel_contact_id: null,
    },
  ];

  const summary = computeDashboardAlerts({
    shifts,
    obligations,
    now: "2026-09-12",
  });

  assert.equal(summary.hasAlerts, false);
  assert.equal(summary.overdueCount, 0);
  assert.equal(summary.overdueAmount, 0);
});

test("plantao agendado ou cancelado nao gera alerta financeiro", () => {
  const shifts = [
    { id: "s1", status: "agendado", place_id: "p1", data: "2026-09-10", hora_inicio: "07:00", hora_fim: "19:00" },
    { id: "s2", status: "cancelado", place_id: "p1", data: "2026-09-01", hora_inicio: "07:00", hora_fim: "19:00" },
  ];
  const obligations = [
    {
      id: "o1",
      shift_id: "s1",
      valor_devido: 1200,
      saldo: 1200,
      data_prevista: "2026-09-05",
      responsavel_place_id: "p1",
      responsavel_contact_id: null,
    },
    {
      id: "o2",
      shift_id: "s2",
      valor_devido: 1000,
      saldo: 1000,
      data_prevista: "2026-09-05",
      responsavel_place_id: "p1",
      responsavel_contact_id: null,
    },
  ];

  const summary = computeDashboardAlerts({
    shifts,
    obligations,
    now: "2026-09-12",
  });

  assert.equal(summary.hasAlerts, false);
  assert.equal(summary.overdueCount, 0);
});

test("invariante de atraso: vence no dia D, atrasa no dia D+1", () => {
  const shifts = [
    { id: "s1", status: "realizado", place_id: "p1", data: "2026-09-01", hora_inicio: "07:00", hora_fim: "19:00" },
  ];
  const obligations = [
    {
      id: "o1",
      shift_id: "s1",
      valor_devido: 2000,
      saldo: 2000,
      data_prevista: "2026-09-06",
      responsavel_place_id: "p1",
      responsavel_contact_id: null,
    },
  ];

  // No dia do vencimento (2026-09-06), ainda NAO esta em atraso; esta a vencer hoje (upcoming com 0 dias)
  const onDueDate = computeDashboardAlerts({
    shifts,
    obligations,
    now: "2026-09-06",
  });
  assert.equal(onDueDate.overdueCount, 0);
  assert.equal(onDueDate.upcomingCount, 1);
  assert.equal(onDueDate.topUpcoming?.daysUntilDue, 0);

  // No dia seguinte (2026-09-07), passa a estar em atraso
  const dayAfter = computeDashboardAlerts({
    shifts,
    obligations,
    now: "2026-09-07",
  });
  assert.equal(dayAfter.overdueCount, 1);
  assert.equal(dayAfter.overdueAmount, 2000);
  assert.equal(dayAfter.topOverdue?.daysOverdue, 1);
  assert.equal(dayAfter.upcomingCount, 0);
});

test("alerta preventivo para plantoes vencendo em ate 7 dias", () => {
  const shifts = [
    { id: "s1", status: "realizado", place_id: "p1", data: "2026-09-01", hora_inicio: "07:00", hora_fim: "19:00" },
    { id: "s2", status: "realizado", place_id: "p1", data: "2026-09-02", hora_inicio: "07:00", hora_fim: "19:00" },
    { id: "s3", status: "realizado", place_id: "p1", data: "2026-09-03", hora_inicio: "07:00", hora_fim: "19:00" },
  ];
  const obligations = [
    // Vence em 3 dias (dentro dos 7 dias)
    { id: "o1", shift_id: "s1", valor_devido: 1000, saldo: 1000, data_prevista: "2026-09-15", responsavel_place_id: "p1", responsavel_contact_id: null },
    // Vence em 7 dias (limite exato dos 7 dias)
    { id: "o2", shift_id: "s2", valor_devido: 1500, saldo: 500, data_prevista: "2026-09-19", responsavel_place_id: "p1", responsavel_contact_id: null },
    // Vence em 8 dias (alem dos 7 dias) -> nao deve entrar no preventivo
    { id: "o3", shift_id: "s3", valor_devido: 2000, saldo: 2000, data_prevista: "2026-09-20", responsavel_place_id: "p1", responsavel_contact_id: null },
  ];

  const summary = computeDashboardAlerts({
    shifts,
    obligations,
    now: "2026-09-12",
  });

  assert.equal(summary.overdueCount, 0);
  assert.equal(summary.upcomingCount, 2);
  assert.equal(summary.upcomingAmount, 1500); // 1000 + 500 (saldo restante)
  assert.equal(summary.topUpcoming?.obligationId, "o1");
  assert.equal(summary.topUpcoming?.daysUntilDue, 3);
});

test("identifica o maior devedor/maior atraso para acao rapida", () => {
  const places = [
    { id: "p1", nome: "Hospital Esperança" },
    { id: "p2", nome: "UPA Zona Sul" },
  ];
  const contacts = [
    { id: "c1", nome: "Dr. Roberto" },
  ];
  const shifts = [
    { id: "s1", status: "realizado", place_id: "p1", data: "2026-08-01", hora_inicio: "07:00", hora_fim: "19:00" },
    { id: "s2", status: "realizado", place_id: "p2", data: "2026-08-15", hora_inicio: "07:00", hora_fim: "19:00" },
    { id: "s3", status: "realizado", place_id: "p1", data: "2026-08-20", hora_inicio: "07:00", hora_fim: "19:00" },
  ];
  const obligations = [
    // R$ 800 atrasado ha 30 dias
    { id: "o1", shift_id: "s1", valor_devido: 800, saldo: 800, data_prevista: "2026-08-10", responsavel_place_id: "p1", responsavel_contact_id: null },
    // R$ 3.500 atrasado ha 10 dias (maior saldo atrasado)
    { id: "o2", shift_id: "s2", valor_devido: 3500, saldo: 3500, data_prevista: "2026-09-02", responsavel_place_id: null, responsavel_contact_id: "c1" },
    // R$ 1.200 atrasado ha 5 dias
    { id: "o3", shift_id: "s3", valor_devido: 1200, saldo: 1200, data_prevista: "2026-09-07", responsavel_place_id: "p1", responsavel_contact_id: null },
  ];

  const summary = computeDashboardAlerts({
    shifts,
    obligations,
    places,
    contacts,
    now: "2026-09-12",
  });

  assert.equal(summary.overdueCount, 3);
  assert.equal(summary.overdueAmount, 5500);
  assert.ok(summary.topOverdue);
  assert.equal(summary.topOverdue.obligationId, "o2");
  assert.equal(summary.topOverdue.responsibleName, "Dr. Roberto");
  assert.equal(summary.topOverdue.placeName, "UPA Zona Sul");
  assert.equal(summary.topOverdue.balance, 3500);
  assert.equal(summary.topOverdue.daysOverdue, 10);
});

test("filtro por placeId restringe os alertas apenas ao local selecionado", () => {
  const places = [
    { id: "p1", nome: "Hospital A" },
    { id: "p2", nome: "Hospital B" },
  ];
  const shifts = [
    { id: "s1", status: "realizado", place_id: "p1", data: "2026-08-01", hora_inicio: "07:00", hora_fim: "19:00" },
    { id: "s2", status: "realizado", place_id: "p2", data: "2026-08-01", hora_inicio: "07:00", hora_fim: "19:00" },
  ];
  const obligations = [
    { id: "o1", shift_id: "s1", valor_devido: 1000, saldo: 1000, data_prevista: "2026-08-10", responsavel_place_id: "p1", responsavel_contact_id: null },
    { id: "o2", shift_id: "s2", valor_devido: 2000, saldo: 2000, data_prevista: "2026-08-10", responsavel_place_id: "p2", responsavel_contact_id: null },
  ];

  // Com ALL_PLACES
  const allSummary = computeDashboardAlerts({
    shifts,
    obligations,
    places,
    placeId: "all",
    now: "2026-09-12",
  });
  assert.equal(allSummary.overdueCount, 2);
  assert.equal(allSummary.overdueAmount, 3000);

  // Filtrando por p1
  const p1Summary = computeDashboardAlerts({
    shifts,
    obligations,
    places,
    placeId: "p1",
    now: "2026-09-12",
  });
  assert.equal(p1Summary.overdueCount, 1);
  assert.equal(p1Summary.overdueAmount, 1000);
  assert.equal(p1Summary.topOverdue?.placeName, "Hospital A");
});
