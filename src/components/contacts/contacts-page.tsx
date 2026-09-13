"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { CardSkeleton } from "@/components/ui/skeletons";
import { cn } from "cn";
import {
  createContact,
  listContacts,
  removeContact,
  updateContact,
  type Contact,
  type ContactInput,
} from "@/lib/contacts";
import { useFocusTrap } from "@/lib/accessibility/use-focus-trap";

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
  const contactDialogRef = useRef<HTMLElement>(null);
  useFocusTrap(isFormOpen, contactDialogRef);

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
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">MeuPlantão</p>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-4xl">Contatos de repasse</h1>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Cadastre quem cuida dos seus pagamentos para encontrar essa informação quando precisar.
            </p>
          </div>
          <Button
            type="button"
            size="default"
            onClick={openCreate}
            className="min-h-[44px] gap-2 shrink-0"
            aria-label="Adicionar contato"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">Adicionar</span>
          </Button>
        </header>

        {error && !isFormOpen && (
          <div role="alert" className="mb-5 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <section aria-labelledby="contacts-list-title">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="contacts-list-title" className="text-lg font-semibold text-foreground">
              Seus contatos
            </h2>
            <span className="text-sm text-muted-foreground">
              {contacts.length} {contacts.length === 1 ? "contato" : "contatos"}
            </span>
          </div>

          {loading ? (
            <div role="status" aria-label="Carregando contatos..." className="space-y-3">
              <CardSkeleton lines={2} />
              <CardSkeleton lines={2} />
              <CardSkeleton lines={2} />
            </div>
          ) : contacts.length === 0 ? (
            <EmptyState
              icon={UserRound}
              title="Nenhum contato cadastrado"
              description="Adicione escalas e responsáveis por repasse financeiro."
              action={
                <Button type="button" onClick={openCreate} className="min-h-[44px] gap-2">
                  <Plus className="size-4" />
                  Adicionar contato
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {contacts.map((contact) => (
                <article
                  key={contact.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-border/80 sm:p-5"
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                      <UserRound className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-foreground">{contact.nome}</h3>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {contact.tipo === "pessoa" ? "Pessoa" : "Instituição"} · {formatPhone(contact.telefone)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(contact)}
                      aria-label={`Editar ${contact.nome}`}
                      className="size-11 min-h-[44px] min-w-[44px]"
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 min-h-[44px] min-w-[44px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void handleDelete(contact)}
                      disabled={deletingId === contact.id}
                      aria-label={`Excluir ${contact.nome}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {isFormOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !saving) setIsFormOpen(false);
            }}
          >
            <section
              ref={contactDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="contact-form-title"
              tabIndex={-1}
              className="w-full rounded-t-2xl border border-border bg-card p-6 shadow-xl sm:max-w-md sm:rounded-2xl"
            >
              <div className="mb-5 flex items-center justify-between">
                <h2 id="contact-form-title" className="text-xl font-bold tracking-tight text-foreground">
                  {editingId ? "Editar contato" : "Novo contato"}
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={closeForm}
                  aria-label="Fechar formulário"
                  className="size-11 min-h-[44px] min-w-[44px]"
                >
                  <X className="size-5" />
                </Button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="contact-nome" className="block text-sm font-medium text-foreground">
                    Nome
                  </label>
                  <Input
                    id="contact-nome"
                    autoFocus
                    required
                    maxLength={120}
                    value={form.nome}
                    onChange={(event) => setForm({ ...form, nome: event.target.value })}
                    placeholder="Ex.: Hospital São Lucas ou Dr. Carlos"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="contact-telefone" className="block text-sm font-medium text-foreground">
                      Telefone
                    </label>
                    <span className="text-xs text-muted-foreground">Opcional</span>
                  </div>
                  <Input
                    id="contact-telefone"
                    type="tel"
                    inputMode="tel"
                    maxLength={30}
                    value={form.telefone ?? ""}
                    onChange={(event) => setForm({ ...form, telefone: event.target.value })}
                    placeholder="(00) 00000-0000"
                  />
                </div>

                <fieldset>
                  <legend className="text-sm font-medium text-foreground">Tipo de contato</legend>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    {[
                      { value: "instituicao", label: "Instituição" },
                      { value: "pessoa", label: "Pessoa" },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          "flex min-h-[44px] cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-center text-sm font-medium transition select-none touch-manipulation",
                          form.tipo === option.value
                            ? "border-primary bg-primary/10 text-primary shadow-xs"
                            : "border-border bg-card text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <input
                          type="radio"
                          name="tipo"
                          value={option.value}
                          checked={form.tipo === option.value}
                          onChange={(event) => setForm({ ...form, tipo: event.target.value as "instituicao" | "pessoa" })}
                          className="sr-only"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

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
                    {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Adicionar contato"}
                  </Button>
                </div>
              </form>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

