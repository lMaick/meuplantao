"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      .then((result) => { setPlaces(result); setError(""); })
      .catch(() => { setLoadError(true); setError("Não foi possível carregar os locais. Tente novamente."); })
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void refresh(); });
    return () => { active = false; };
  }, []);

  function startCreate() { setEditingId(null); setForm(emptyForm); setError(""); setOpen(true); }
  function startEdit(place: Place) { setEditingId(place.id); setForm({ nome: place.nome, endereco: place.endereco ?? "" }); setError(""); setOpen(true); }
  function closeForm() { if (!saving) setOpen(false); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nome = form.nome.trim();
    if (!nome) { setError("Informe o nome do local."); return; }
    setSaving(true); setError("");
    try {
      const input = { nome, endereco: form.endereco.trim() || null };
      if (editingId) await updatePlace(editingId, input); else await createPlace(input);
      setOpen(false); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar o local."); }
    finally { setSaving(false); }
  }

  async function handleRemove(place: Place) {
    if (!window.confirm(`Excluir “${place.nome}”?`)) return;
    try { await removePlace(place.id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível excluir o local."); }
  }

  return <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8 sm:px-8">
    <header className="mb-8 flex items-start justify-between gap-4">
      <div><p className="mb-2 text-sm font-medium text-muted-foreground">MeuPlantao</p><h1 className="text-3xl font-semibold tracking-tight">Locais de trabalho</h1><p className="mt-2 text-muted-foreground">Cadastre onde seus plantões acontecem.</p></div>
      <Button onClick={startCreate} size="lg" aria-label="Adicionar local"><Plus /> <span className="hidden sm:inline">Adicionar</span></Button>
    </header>
    {error && !open && <p role="alert" className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {loading ? <p role="status" className="py-12 text-center text-muted-foreground">Carregando locais...</p> : loadError ? <Button onClick={() => void refresh()}>Tentar novamente</Button> : places.length === 0 ? <section className="rounded-2xl border border-dashed p-8 text-center"><MapPin className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="font-medium">Nenhum local cadastrado</h2><p className="mt-1 text-sm text-muted-foreground">Adicione seu primeiro local de trabalho.</p><Button className="mt-5" onClick={startCreate}>Cadastrar local</Button></section> : <section className="space-y-3" aria-label="Locais cadastrados">{places.map((place) => <article key={place.id} className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm"><div className="min-w-0"><h2 className="truncate font-medium">{place.nome}</h2>{place.endereco && <p className="mt-1 truncate text-sm text-muted-foreground">{place.endereco}</p>}</div><div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" onClick={() => startEdit(place)} aria-label={`Editar ${place.nome}`}><Pencil /></Button><Button variant="ghost" size="icon" onClick={() => void handleRemove(place)} aria-label={`Excluir ${place.nome}`}><Trash2 /></Button></div></article>)}</section>}
    {!loading && !loadError && places.length > 0 && <p className="mt-6 text-sm">Local pronto! <Link href="/calendario" className="inline-block py-3 font-medium underline">Abra o calendário para cadastrar um plantão</Link>.</p>}
    {open && <div className="fixed inset-0 z-10 flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4"><section role="dialog" aria-modal="true" aria-labelledby="place-form-title" className="w-full rounded-t-2xl bg-background p-6 shadow-xl sm:max-w-md sm:rounded-2xl"><div className="mb-5 flex items-center justify-between"><h2 id="place-form-title" className="text-xl font-semibold">{editingId ? "Editar local" : "Novo local"}</h2><Button variant="ghost" size="icon" onClick={closeForm} aria-label="Fechar"><X /></Button></div><form onSubmit={submit} className="space-y-4"><label className="block text-sm font-medium">Nome do local<input required autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="mt-1.5 h-11 w-full rounded-lg border bg-background px-3 font-normal outline-none focus:ring-2 focus:ring-ring" placeholder="Ex.: Hospital Central" /></label><label className="block text-sm font-medium">Endereço ou contato responsável<span className="mt-1 block text-xs font-normal text-muted-foreground">Opcional</span><input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} className="mt-1.5 h-11 w-full rounded-lg border bg-background px-3 font-normal outline-none focus:ring-2 focus:ring-ring" placeholder="Ex.: Rua das Flores, 100" /></label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={closeForm}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar local"}</Button></div></form></section></div>}
  </main>;
}
