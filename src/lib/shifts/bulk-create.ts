/**
 * Criacao de varios plantoes em sequencia, com chave de idempotencia propria
 * por data, estavel entre tentativas. Modulo puro: a funcao de salvar entra por
 * parametro e nada aqui conhece banco de dados, React ou imports com alias.
 */

export const MAX_BULK_DATES = 31;

export type BulkEntry = { data: string; key: string };

export type BulkFailure = { data: string; key: string; message: string };

export type BulkRunResult<R> = {
  /** Plantoes salvos nesta rodada, na ordem das datas. */
  saved: { data: string; key: string; result: R }[];
  /** Datas que falharam nesta rodada, com a mesma chave para o reenvio. */
  failed: BulkFailure[];
  /** Verdadeiro quando nao resta nenhuma data pendente. */
  complete: boolean;
};

export function normalizeBulkDates(dates: readonly string[]): string[] {
  return Array.from(new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))).sort();
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Falha ao salvar.";
}

export class BulkCreateSession<R> {
  private readonly newKey: () => string;
  private readonly keys = new Map<string, string>();
  private readonly done = new Set<string>();
  private planned: string[] = [];
  private discarded = false;

  constructor(newKey: () => string) {
    this.newKey = newKey;
  }

  /**
   * Chave da data: criada uma vez e reutilizada em todo reenvio. `preset` (ex.:
   * a chave da intencao de criacao) so vale se ainda nao estiver em uso por
   * outra data, para nunca repetir a mesma chave em datas diferentes.
   */
  keyFor(date: string, preset?: string): string {
    if (this.discarded) throw new Error("sessao de criacao em lote descartada");
    const existing = this.keys.get(date);
    if (existing) return existing;
    const used = new Set(this.keys.values());
    const key = preset && !used.has(preset) ? preset : this.newKey();
    this.keys.set(date, key);
    return key;
  }

  /** Datas ainda nao salvas, na ordem planejada. */
  get pendingDates(): string[] {
    return this.planned.filter((date) => !this.done.has(date));
  }

  get isActive(): boolean {
    return !this.discarded;
  }

  /**
   * Salva em sequencia (nunca em paralelo). Sem `dates`, reenvia apenas as
   * pendentes; datas ja salvas nunca sao enviadas de novo.
   */
  async run(
    save: (entry: BulkEntry) => Promise<R>,
    dates?: readonly string[],
    presets: Readonly<Record<string, string>> = {}
  ): Promise<BulkRunResult<R>> {
    if (this.discarded) throw new Error("sessao de criacao em lote descartada");
    if (dates) this.planned = normalizeBulkDates(dates);
    const saved: BulkRunResult<R>["saved"] = [];
    const failed: BulkFailure[] = [];
    for (const date of this.pendingDates) {
      const key = this.keyFor(date, presets[date]);
      try {
        const result = await save({ data: date, key });
        this.done.add(date);
        saved.push({ data: date, key, result });
      } catch (error) {
        failed.push({ data: date, key, message: messageOf(error) });
      }
    }
    return { saved, failed, complete: this.pendingDates.length === 0 };
  }

  /** Cancelar o formulario descarta as chaves e o progresso. */
  discard(): void {
    this.discarded = true;
    this.keys.clear();
    this.done.clear();
    this.planned = [];
  }
}
