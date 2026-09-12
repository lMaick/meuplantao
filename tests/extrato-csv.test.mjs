import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExtratoCsv,
  escapeCsvCell,
  extratoFilename,
  formatDataBR,
  formatMoeda,
  situacaoFinanceira,
} from "../src/lib/exports/extrato-csv.ts";

test("csv usa BOM, separador ponto-e-virgula e header completo", () => {
  const csv = buildExtratoCsv([]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const primeiraLinha = csv.slice(1).split("\r\n")[0];
  assert.ok(primeiraLinha.includes(";"));
  for (const coluna of ["Data do Plant", "Local / Hospital", "Financeira"]) {
    assert.ok(primeiraLinha.includes(coluna), `header possui ${coluna}`);
  }
  assert.equal(primeiraLinha.split(";").length, 10);
});

test("escape protege aspas, ponto-e-virgula e virgulas do padrao BR", () => {
  assert.equal(escapeCsvCell("Hospital; Central"), `"Hospital; Central"`);
  assert.equal(escapeCsvCell(`Dra. "Ana", plantao`), `"Dra. ""Ana"", plantao"`);
  assert.equal(escapeCsvCell("R$ 1.234,56"), `"R$ 1.234,56"`);
  assert.equal(escapeCsvCell("simples"), "simples");
});

test("valores nulos viram zero BR e datas vazias", () => {
  for (const vazio of [formatMoeda(null), formatMoeda(undefined)]) {
    assert.ok(vazio.includes("0,00"), `zero BR em ${vazio}`);
    assert.ok(vazio.includes("R$"), `cifrao em ${vazio}`);
  }
  assert.ok(formatMoeda(1234.56).includes("1.234,56"));
  assert.equal(formatDataBR(null), "");
  assert.equal(formatDataBR("2026-09-10"), "10/09/2026");
});

test("situacao deriva de saldo e atraso, nunca de campo manual", () => {
  assert.equal(situacaoFinanceira({ valorPrevisto: 500, valorRecebido: 500, saldo: 0, atrasado: false }), "Recebido");
  assert.equal(situacaoFinanceira({ valorPrevisto: 500, valorRecebido: 200, saldo: 300, atrasado: false }), "Parcial");
  assert.equal(situacaoFinanceira({ valorPrevisto: 500, valorRecebido: 0, saldo: 500, atrasado: false }), "Pendente");
  assert.equal(situacaoFinanceira({ valorPrevisto: 500, valorRecebido: 0, saldo: 500, atrasado: true }), "Atrasado");
  assert.equal(situacaoFinanceira({ valorPrevisto: 0, valorRecebido: 0, saldo: 0, atrasado: false }), "Pendente");
});

test("linha completa respeita saldo recebido igual previsto menos saldo", () => {
  const csv = buildExtratoCsv([
    {
      dataPlantao: "2026-09-10",
      local: "Hospital Central",
      tipo: null,
      statusPlantao: "realizado",
      responsavel: "Contato - Dra. Ana",
      dataPrevista: "2026-10-10",
      valorPrevisto: 1000,
      valorRecebido: 400,
      saldo: 600,
      atrasado: false,
    },
  ]);
  const linhas = csv.slice(1).split("\r\n");
  assert.equal(linhas.length, 2);
  assert.ok(linhas[1].includes("10/09/2026"));
  assert.ok(linhas[1].includes("Parcial"));
});

test("nome do arquivo segue meuplantao-extrato-YYYY-MM-DD", () => {
  const nome = extratoFilename(new Date("2026-09-12T12:00:00-03:00"));
  assert.equal(nome, "meuplantao-extrato-2026-09-12.csv");
});

