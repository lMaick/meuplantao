"use client";

import { useEffect, useState } from "react";
import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/primitives";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { LogoutButton } from "@/lib/auth/logout-button";

interface ProfileSummary {
  email: string | null;
  displayName: string | null;
  initials: string;
  memberSince: string | null;
}

function toInitials(name: string | null, email: string | null): string {
  const source = (name ?? "").trim() || (email ?? "").split("@")[0] || "";
  if (!source) return "MP";
  const parts = source.replace(/[._-]+/g, " ").split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Carregando perfil">
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="size-14 shrink-0 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-5 w-40 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            <div className="h-4 w-56 max-w-full animate-pulse rounded-md bg-muted/70 motion-reduce:animate-none" />
          </div>
          <div className="h-6 w-24 shrink-0 animate-pulse rounded-full bg-muted/70 motion-reduce:animate-none" />
        </div>
      </Card>
      <Card className="p-5 sm:p-6">
        <div className="h-5 w-44 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="mt-2 h-4 w-full max-w-md animate-pulse rounded-md bg-muted/60 motion-reduce:animate-none" />
        <div className="mt-5 h-11 w-full animate-pulse rounded-lg bg-muted/70 motion-reduce:animate-none sm:w-56" />
      </Card>
      <span className="sr-only">Carregando dados do perfil…</span>
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!active) return;
        if (!user) {
          setProfile({ email: null, displayName: null, initials: "MP", memberSince: null });
          return;
        }
        const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
        const displayName =
          (meta.full_name as string | undefined) ??
          (meta.name as string | undefined) ??
          null;
        setProfile({
          email: user.email ?? null,
          displayName,
          initials: toInitials(displayName, user.email ?? null),
          memberSince: user.created_at ?? null,
        });
      } catch {
        if (active) setProfile({ email: null, displayName: null, initials: "MP", memberSince: null });
      } finally {
        if (active) setIsLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const memberSinceLabel = profile?.memberSince
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(profile.memberSince))
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 motion-reduce:animate-none">
      <PageHeader title="Perfil" description="Consulte seus dados pessoais e gerencie sua sessão." />

      {isLoading ? (
        <ProfileSkeleton />
      ) : (
        <>
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-4">
              <div
                aria-hidden="true"
                className="grid size-14 shrink-0 place-items-center rounded-full bg-primary/10 text-lg font-bold text-primary ring-1 ring-primary/25"
              >
                {profile?.initials ?? "MP"}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-bold tracking-tight text-foreground">
                  {profile?.displayName ?? profile?.email ?? "Sua conta"}
                </h2>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {profile?.email ?? "Entre para ver os dados da sua conta."}
                </p>
                {memberSinceLabel && (
                  <p className="mt-1 text-xs text-muted-foreground">Membro desde {memberSinceLabel}</p>
                )}
              </div>
              <Badge variant="success" dot className="shrink-0">
                Sessão ativa
              </Badge>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/20">
                <LogOut className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight text-foreground">Sessão &amp; Acesso</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Encerre a sessão neste dispositivo para trocar de conta com segurança. Você será
                  redirecionado para /login.
                </p>
              </div>
            </div>
            <div className="mt-5 border-t border-border/80 pt-5">
              <LogoutButton variant="destructive" className="w-full sm:w-auto" />
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
                O logout encerra a sessão no Supabase apenas neste navegador.
              </p>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border/60">
                <UserRound className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-semibold text-foreground">Dados do perfil</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  A edição de nome e foto do perfil estará disponível em breve. Seus dados de acesso
                  são gerenciados com segurança pela autenticação.
                </p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
