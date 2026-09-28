export type ExtratoSituacao = "Recebido" | "Pendente" | "Parcial" | "Atrasado";

export type ExtratoRow = {
  dataPlantao: string | null;
  local: string | null;
  tipo: string | null;
  statusPlantao: string | null;
  responsavel: string | null;
  dataPrevista: string | null;
  valorPrevisto: number | null;
  valorRecebido: number | null;
  saldo: number | null;
  atrasado: boolean;
};

export const EXTRATO_HEADER = [
  "Data do Plant\u00e3o",
  "Local / Hospital",
  "Tipo / Especialidade",
  "Status do Plant\u00e3o",
  "Contato Respons\u00e1vel pelo Repasse",
  "Data Prevista de Recebimento",
  "Valor Previsto (R$)",
  "Valor J\u00e1 Recebido (R$)",
  "Saldo Restante (R$)",
  "Situa\u00e7\u00e3o Financeira",
];

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatMoeda(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return moeda.format(0);
  return moeda.format(Number(valor));
}

export function formatDataBR(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatStatusPlantao(status: string | null | undefined): string {
  if (status === "realizado") return "Realizado";
  if (status === "agendado") return "Agendado";
  if (status === "cancelado") return "Cancelado";
  if (!status) return "";
  return status.charAt(0).toLocaleUpperCase("pt-BR") + status.slice(1);
}

export function situacaoFinanceira(row: Pick<ExtratoRow, "valorPrevisto" | "valorRecebido" | "saldo" | "atrasado">): ExtratoSituacao {
  const recebido = Math.max(0, Number(row.valorRecebido ?? 0));
  const saldo = Math.max(0, Number(row.saldo ?? 0));
  if (saldo <= 0 && recebido > 0) return "Recebido";
  if (row.atrasado && saldo > 0) return "Atrasado";
  if (recebido > 0 && saldo > 0) return "Parcial";
  return "Pendente";
}

export function isFormulaInjection(texto: string): boolean {
  if (!texto || typeof texto !== "string") return false;
  if (texto.startsWith("'")) return false;
  return /^[\s\t\r]*[=+\-@]/.test(texto) || /^[\t\r]/.test(texto);
}

export function escapeCsvCell(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  let texto = String(valor);

  if (typeof valor === "string" && isFormulaInjection(texto)) {
    texto = `'${texto}`;
  }

  if (/[";\r\n,]/.test(texto)) return `"${texto.replaceAll('"', '""')}"`;
  return texto;
}

export function buildExtratoCsv(rows: ExtratoRow[], separator = ";"): string {
  const lines = [
    EXTRATO_HEADER.map((cell) => escapeCsvCell(cell)).join(separator),
    ...rows.map((row) =>
      [
        formatDataBR(row.dataPlantao),
        row.local ?? "",
        row.tipo ?? "",
        formatStatusPlantao(row.statusPlantao),
        row.responsavel ?? "",
        formatDataBR(row.dataPrevista),
        formatMoeda(row.valorPrevisto),
        formatMoeda(row.valorRecebido),
        formatMoeda(row.saldo),
        situacaoFinanceira(row),
      ]
        .map((cell) => escapeCsvCell(cell))
        .join(separator),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

export function extratoFilename(hoje = new Date()): string {
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(hoje);
  return `meuplantao-extrato-${dia}.csv`;
}

export function downloadExtratoCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
