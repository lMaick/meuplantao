"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { useSubscription } from "@/lib/subscription";
import { useIsTwa } from "@/lib/twa/use-is-twa";
import { createClient } from "@/lib/supabase/client";
import { cn } from "cn";

export default function ProfilePage() {
  const router = useRouter();
  const isTwa = useIsTwa();
  const { trial, isLoading } = useSubscription();
  const [email, setEmail] = useState("");
  useEffect(() => { void createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? "")); }, []);
  async function signOut() { await createClient().auth.signOut({ scope: "local" }); router.replace("/login"); }
  return <div className="mx-auto max-w-3xl px-5 py-6"><PageHeader title="Perfil" description="Resumo da sua conta." />
    <Card className="grid gap-5 p-5"><section><h2 className="font-semibold">Conta</h2>{email ? <p className="mt-2 text-sm text-muted-foreground">{email}</p> : <div aria-label="Carregando e-mail" className="mt-2 h-5 w-48 animate-pulse rounded bg-muted" />}</section>
      <section><h2 className="font-semibold">{isTwa ? "Acesso" : "Plano"}</h2>{isLoading ? <div aria-label="Carregando plano" className="mt-2 h-5 w-40 animate-pulse rounded bg-muted" /> : <p className="mt-2 text-sm text-muted-foreground">{trial?.isActive ? `${isTwa ? "Acesso completo ativo até" : "MeuPlantão Pro válido até"} ${new Date(trial.currentPeriodEnd!).toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })}` : trial?.isTrialing ? `${isTwa ? "Período de avaliação:" : "Teste grátis:"} ${trial.daysRemaining} dias restantes` : isTwa ? "Modo leitura" : "Teste grátis encerrado"}</p>}</section>
      <nav aria-label="Atalhos da conta" className="flex flex-wrap gap-3">{!isTwa && <Link data-twa-hide="true" className={buttonVariants({ variant: "outline" })} href="/assinatura">Assinatura</Link>}<Link className={buttonVariants({ variant: "outline" })} href="/suporte">Suporte</Link><Button variant="outline" onClick={() => void signOut()}>Sair da conta</Button></nav>
      <section className="border-t border-border/80 pt-5"><h2 className="font-semibold">Excluir conta</h2><p className="mt-2 text-sm text-muted-foreground">Apaga sua conta e todos os seus dados. Não pode ser desfeito.</p><Link className={cn(buttonVariants({ variant: "destructive" }), "mt-3 min-h-[44px]")} href="/excluir-conta">Excluir conta</Link></section>
    </Card></div>;
}
