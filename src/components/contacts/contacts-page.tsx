"use client";

import { FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createContact,
  listContacts,
  removeContact,
  updateContact,
  type Contact,
  type ContactInput,
} from "@/lib/contacts";

const emptyForm: ContactInput = { nome: "", telefone: "", tipo: "instituicao" };

function formatPhone(phone: string | null) {
  if (!phone) return "Telefone não informado";
  return phone;
}

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [form, setForm] = useState<ContactInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadContacts() {
    try {
      setLoading(true);
      setError(null);
      setContacts(await listContacts());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os contatos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void listContacts()
      .then((loadedContacts) => {
        if (active) setContacts(loadedContacts);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os contatos.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function openCreate() {
    setForm(emptyForm);
    setEditingId(null);
    setError(null);
    setIsFormOpen(true);
  }

  function openEdit(contact: Contact) {
    setForm({ nome: contact.nome, telefone: contact.telefone ?? "", tipo: contact.tipo ?? "instituicao" });
    setEditingId(contact.id);
    setError(null);
    setIsFormOpen(true);
  }

  function closeForm() {
    if (!saving) setIsFormOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nome = form.nome.trim();
    const telefone = form.telefone?.trim() ?? "";
    if (!nome) {
      setError("Informe o nome do contato.");
      return;
    }
    if (nome.length < 2) {
      setError("O nome deve ter pelo menos 2 caracteres.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const input = { nome, telefone: telefone || null, tipo: form.tipo || "instituicao" };
      if (editingId) await updateContact(editingId, input);
      else await createContact(input);
      setIsFormOpen(false);
      await loadContacts();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o contato.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(contact: Contact) {
    if (!window.confirm(`Excluir o contato “${contact.nome}”?`)) return;
    try {
      setDeletingId(contact.id);
      setError(null);
      await removeContact(contact.id);
      setContacts((current) => current.filter((item) => item.id !== contact.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir o contato.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">MeuPlantao</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Contatos de repasse</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">Cadastre quem cuida dos seus pagamentos para encontrar essa informação quando precisar.</p>
          </div>
          <Button type="button" size="lg" onClick={openCreate} aria-label="Adicionar contato">
            <Plus /> <span className="hidden sm:inline">Adicionar</span>
          </Button>
        </header>

        {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {isFormOpen && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="contact-form-title">
            <div className="mb-5 flex items-center justify-between">
              <h2 id="contact-form-title" className="text-lg font-semibold">{editingId ? "Editar contato" : "Novo contato"}</h2>
              <Button type="button" variant="ghost" size="icon" onClick={closeForm} aria-label="Fechar formulário"><X /></Button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block text-sm font-medium">Nome
                <input autoFocus required maxLength={120} value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} placeholder="Ex.: Hospital São Lucas" className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none transition focus:border-sky-600 focus:ring-3 focus:ring-sky-100" />
              </label>
              <label className="block text-sm font-medium">Telefone <span className="font-normal text-slate-500">(opcional)</span>
                <input type="tel" inputMode="tel" maxLength={30} value={form.telefone ?? ""} onChange={(event) => setForm({ ...form, telefone: event.target.value })} placeholder="(00) 00000-0000" className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none transition focus:border-sky-600 focus:ring-3 focus:ring-sky-100" />
              </label>
              <fieldset>
                <legend className="text-sm font-medium">Tipo</legend>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {[{ value: "instituicao", label: "Instituição" }, { value: "pessoa", label: "Pessoa" }].map((option) => (
                    <label key={option.value} className={`cursor-pointer rounded-lg border px-3 py-3 text-center text-sm transition ${form.tipo === option.value ? "border-sky-600 bg-sky-50 text-sky-800" : "border-slate-300 hover:bg-slate-50"}`}>
                      <input type="radio" name="tipo" value={option.value} checked={form.tipo === option.value} onChange={(event) => setForm({ ...form, tipo: event.target.value })} className="sr-only" />{option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? "Salvando..." : editingId ? "Salvar alterações" : "Adicionar contato"}</Button>
              </div>
            </form>
          </section>
        )}

        <section aria-labelledby="contacts-list-title">
          <div className="mb-3 flex items-center justify-between"><h2 id="contacts-list-title" className="text-lg font-semibold">Seus contatos</h2><span className="text-sm text-slate-500">{contacts.length} {contacts.length === 1 ? "contato" : "contatos"}</span></div>
          {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Carregando contatos...</div> : contacts.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><UserRound className="mx-auto mb-3 text-slate-400" size={32} /><h3 className="font-semibold">Nenhum contato cadastrado</h3><p className="mt-1 text-sm text-slate-500">Adicione seu primeiro contato de repasse.</p><Button type="button" className="mt-5" onClick={openCreate}><Plus /> Adicionar contato</Button></div> : <div className="space-y-3">{contacts.map((contact) => <article key={contact.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex min-w-0 items-center gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700"><UserRound size={21} /></div><div className="min-w-0"><h3 className="truncate font-semibold">{contact.nome}</h3><p className="mt-1 truncate text-sm text-slate-500">{contact.tipo === "pessoa" ? "Pessoa" : "Instituição"} · {formatPhone(contact.telefone)}</p></div></div><div className="flex shrink-0 gap-1"><Button type="button" variant="ghost" size="icon" onClick={() => openEdit(contact)} aria-label={`Editar ${contact.nome}`}><Pencil /></Button><Button type="button" variant="ghost" size="icon" className="text-red-600 hover:text-red-700" onClick={() => void handleDelete(contact)} disabled={deletingId === contact.id} aria-label={`Excluir ${contact.nome}`}><Trash2 /></Button></div></article>)}</div>}
        </section>
      </div>
    </main>
  );
}
