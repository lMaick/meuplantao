"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { CardSkeleton } from "@/components/ui/skeletons";
import { createPlace, listPlaces, removePlace, updatePlace, type Place } from "@/lib/places";

const emptyForm = { nome: "", endereco: "" };

export default function PlacesPage() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function refresh() {
    setLoading(true);
    setLoadError(false);
    return listPlaces()
      .then((result) => {
        setPlaces(result);
        setError("");
      })
      .catch(() => {
        setLoadError(true);
        setError("Não foi possível carregar os locais. Tente novamente.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
    };
  }, []);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setOpen(true);
  }

  function startEdit(place: Place) {
    setEditingId(place.id);
    setForm({ nome: place.nome, endereco: place.endereco ?? "" });
    setError("");
    setOpen(true);
  }

  function closeForm() {
    if (!saving) setOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nome = form.nome.trim();
    if (!nome) {
      setError("Informe o nome do local.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const input = { nome, endereco: form.endereco.trim() || null };
      if (editingId) await updatePlace(editingId, input);
      else await createPlace(input);
      setOpen(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar o local.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(place: Place) {
    if (!window.confirm(`Excluir “${place.nome}”?`)) return;
    try {
      await removePlace(place.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível excluir o local.");
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 text-foreground sm:px-8 sm:py-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 w-fit">
            <span className="size-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
            <span>Unidades de Atendimento</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground mt-1">Locais de trabalho</h1>
          <p className="mt-1 text-sm sm:text-base text-muted-foreground">Cadastre hospitais, UPAs e clínicas onde você dá plantão.</p>
        </div>
        <Button
          onClick={startCreate}
          size="default"
          className="min-h-[44px] gap-2 shrink-0 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-sm shadow-emerald-700/20 font-semibold"
          aria-label="Adicionar novo local"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Novo local</span>
          <span className="sm:hidden">Novo</span>
        </Button>
      </header>

      {error && !open && (
        <div role="alert" className="mb-5 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div role="status" aria-label="Carregando locais..." className="space-y-3">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-border/80 bg-card p-8 text-center space-y-4">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => void refresh()} variant="outline" className="min-h-[44px] rounded-xl">
            Tentar novamente
          </Button>
        </div>
      ) : places.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="Nenhum local cadastrado"
          description="Cadastre hospitais e clínicas onde você realiza plantões."
          action={
            <Button onClick={startCreate} className="min-h-[44px] gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-sm shadow-emerald-700/20">
              <Plus className="size-4" />
              + Novo Local
            </Button>
          }
        />
      ) : (
        <section className="space-y-3" aria-label="Locais cadastrados">
          {places.map((place) => (
            <article
              key={place.id}
              className="group relative overflow-hidden flex items-center justify-between gap-4 rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs transition-all hover:border-primary/40 hover:shadow-md"
            >
              <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary ring-1 ring-primary/20 shrink-0">
                  <MapPin className="size-5" />
                </div>
                <div className="min-w-0 space-y-0.5">
                  <h2 className="truncate text-base font-semibold text-foreground">{place.nome}</h2>
                  {place.endereco ? (
                    <p className="truncate text-sm text-muted-foreground">{place.endereco}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground/70">Endereço não informado</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => startEdit(place)}
                  aria-label={`Editar ${place.nome}`}
                  className="size-11 min-h-[44px] min-w-[44px] rounded-xl hover:bg-muted"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void handleRemove(place)}
                  aria-label={`Excluir ${place.nome}`}
                  className="size-11 min-h-[44px] min-w-[44px] rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}

      {!loading && !loadError && places.length > 0 && (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Local pronto!{" "}
          <Link href="/calendario" className="font-semibold text-primary underline-offset-4 hover:underline">
            Abra o calendário para cadastrar um plantão
          </Link>
          .
        </p>
      )}

      {open && <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" onKeyDown={(e) => { if (e.key === "Escape" && !saving) setOpen(false); }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="place-form-title"
            tabIndex={-1}
            className="w-full rounded-t-2xl border border-border bg-card p-6 shadow-xl sm:max-w-md sm:rounded-2xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 id="place-form-title" className="text-xl font-bold tracking-tight text-foreground">
                {editingId ? "Editar local" : "Novo local"}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={closeForm}
                aria-label="Fechar formulário"
                className="size-11 min-h-[44px] min-w-[44px]"
              >
                <X className="size-5" />
              </Button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="place-nome" className="block text-sm font-medium text-foreground">
                  Nome do local
                </label>
                <Input
                  id="place-nome"
                  required
                  autoFocus
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex.: Hospital Central"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="place-endereco" className="block text-sm font-medium text-foreground">
                    Endereço ou contato responsável
                  </label>
                  <span className="text-xs text-muted-foreground">Opcional</span>
                </div>
                <Input
                  id="place-endereco"
                  value={form.endereco}
                  onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                  placeholder="Ex.: Rua das Flores, 100"
                />
              </div>
              {error && (
                <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="flex flex-col-reverse gap-2.5 pt-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeForm}
                  disabled={saving}
                  className="min-h-[44px] w-full sm:w-auto"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] w-full sm:w-auto font-semibold"
                >
                  {saving ? "Salvando..." : "Salvar local"}
                </Button>
              </div>
            </form>
          </section>
        </div>
      }
    </main>
  );
}

