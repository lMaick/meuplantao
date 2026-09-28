import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExtratoCsv,
  escapeCsvCell,
  extratoFilename,
  formatDataBR,
  formatMoeda,
  isFormulaInjection,
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

test("isFormulaInjection detecta caracteres perigosos (=, +, -, @, \\t, \\r) e ignora texto normal", () => {
  // Casos perigosos diretos
  assert.equal(isFormulaInjection("=1+1"), true);
  assert.equal(isFormulaInjection("+SUM(A1:A2)"), true);
  assert.equal(isFormulaInjection("-1+2"), true);
  assert.equal(isFormulaInjection("@SUM(A1:A2)"), true);
  assert.equal(isFormulaInjection('=HYPERLINK("https://example.com","x")'), true);

  // Casos com espaços ou tab antes
  assert.equal(isFormulaInjection("   =1+1"), true);
  assert.equal(isFormulaInjection("\t+SUM(A1:A2)"), true);
  assert.equal(isFormulaInjection("  -1+2"), true);
  assert.equal(isFormulaInjection("\t@SUM(A1:A2)"), true);
  assert.equal(isFormulaInjection("\r=cmd"), true);

  // Casos legítimos seguros (não devem disparar)
  assert.equal(isFormulaInjection("Hospital - Central"), false);
  assert.equal(isFormulaInjection("Dra. Ana (CRM-BA 12345)"), false);
  assert.equal(isFormulaInjection("Plantão Cirúrgico + Emergência"), false);
  assert.equal(isFormulaInjection("R$ 1.234,56"), false);
  assert.equal(isFormulaInjection("Simples"), false);
  assert.equal(isFormulaInjection(""), false);
  assert.equal(isFormulaInjection("   "), false);
  assert.equal(isFormulaInjection(null), false);
  assert.equal(isFormulaInjection(undefined), false);

  // Já neutralizado com apóstrofo
  assert.equal(isFormulaInjection("'=1+1"), false);
});

test("escapeCsvCell neutraliza formula injection prefixando com apostrofo mantendo compatibilidade RFC 4180", () => {
  // 1. =1+1
  assert.equal(escapeCsvCell("=1+1"), "'=1+1");

  // 2. +SUM(A1:A2)
  assert.equal(escapeCsvCell("+SUM(A1:A2)"), "'+SUM(A1:A2)");

  // 3. -1+2
  assert.equal(escapeCsvCell("-1+2"), "'-1+2");

  // 4. @SUM(A1:A2)
  assert.equal(escapeCsvCell("@SUM(A1:A2)"), "'@SUM(A1:A2)");

  // 5. =HYPERLINK("https://example.com","x")
  assert.equal(
    escapeCsvCell('=HYPERLINK("https://example.com","x")'),
    `"'=HYPERLINK(""https://example.com"",""x"")"`
  );

  // 6. Espaços e tabs antes do caractere perigoso
  assert.equal(escapeCsvCell("   =1+1"), "'   =1+1");
  assert.equal(escapeCsvCell("\t+SUM(A1:A2)"), "'\t+SUM(A1:A2)");
  assert.equal(escapeCsvCell("  -1+2"), "'  -1+2");
  assert.equal(escapeCsvCell("\t@SUM(A1:A2)"), "'\t@SUM(A1:A2)");

  // 7. Fórmula contendo delimitadores CSV (; ou , ou quebras de linha)
  assert.equal(escapeCsvCell("=1+1; 2+2"), `"'=1+1; 2+2"`);
  assert.equal(escapeCsvCell("+SUM(A1,B1)"), `"'+SUM(A1,B1)"`);
  assert.equal(escapeCsvCell("-cmd\r\ncalc"), `"'-cmd\r\ncalc"`);

  // 8. Textos legítimos não sofrem alteração indevida
  assert.equal(escapeCsvCell("Hospital São Lucas - Ala Sul"), "Hospital São Lucas - Ala Sul");
  assert.equal(escapeCsvCell("Cirurgia Geral + Trauma"), "Cirurgia Geral + Trauma");
  assert.equal(escapeCsvCell(1234), "1234");
  assert.equal(escapeCsvCell(null), "");
  assert.equal(escapeCsvCell(undefined), "");
});

test("buildExtratoCsv sanitiza campos controlados por usuario contra CSV injection", () => {
  const csv = buildExtratoCsv([
    {
      dataPlantao: "2026-09-10",
      local: "=HYPERLINK(\"http://malicious.site\",\"Hospital\")",
      tipo: "+SUM(1,2)",
      statusPlantao: "realizado",
      responsavel: "@malicious_contact",
      dataPrevista: "2026-10-10",
      valorPrevisto: 1500,
      valorRecebido: 1500,
      saldo: 0,
      atrasado: false,
    },
    {
      dataPlantao: "2026-09-11",
      local: "  -1+2 Clínica Médica",
      tipo: "   =2*3",
      statusPlantao: "agendado",
      responsavel: "\t@dr_gestor",
      dataPrevista: "2026-10-11",
      valorPrevisto: 2000,
      valorRecebido: 0,
      saldo: 2000,
      atrasado: false,
    },
  ]);

  // Deve preservar o UTF-8 BOM
  assert.equal(csv.charCodeAt(0), 0xfeff);

  const linhas = csv.slice(1).split("\r\n");
  assert.equal(linhas.length, 3); // Header + 2 dados

  // Linha 1: células maliciosas neutralizadas
  assert.ok(linhas[1].includes(`"'=HYPERLINK(""http://malicious.site"",""Hospital"")"`));
  assert.ok(linhas[1].includes(`"'+SUM(1,2)"`));
  assert.ok(linhas[1].includes("'@malicious_contact"));

  // Linha 2: células com espaços/tab neutralizadas
  assert.ok(linhas[1].includes("10/09/2026"));
  assert.ok(linhas[2].includes("'-1+2 Clínica Médica") || linhas[2].includes("'  -1+2 Clínica Médica"));
  assert.ok(linhas[2].includes("'   =2*3"));
  assert.ok(linhas[2].includes("'\t@dr_gestor"));

  // Separador ponto-e-vírgula e 10 colunas mantidos
  for (const l of linhas) {
    assert.equal(l.split(";").length >= 10, true);
  }
});


