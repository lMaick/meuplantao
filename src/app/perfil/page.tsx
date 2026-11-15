"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { useSubscription } from "@/lib/subscription";
import { createClient } from "@/lib/supabase/client";

export default function ProfilePage() {
  const router = useRouter();
  const { trial, isLoading } = useSubscription();
  const [email, setEmail] = useState("");
  useEffect(() => { void createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? "")); }, []);
  async function signOut() { await createClient().auth.signOut({ scope: "local" }); router.replace("/login"); }
  return <div className="mx-auto max-w-3xl px-5 py-6"><PageHeader title="Perfil" description="Resumo da sua conta." />
    <Card className="grid gap-5 p-5"><section><h2 className="font-semibold">Conta</h2>{email ? <p className="mt-2 text-sm text-muted-foreground">{email}</p> : <div aria-label="Carregando e-mail" className="mt-2 h-5 w-48 animate-pulse rounded bg-muted" />}</section>
      <section><h2 className="font-semibold">Plano</h2>{isLoading ? <div aria-label="Carregando plano" className="mt-2 h-5 w-40 animate-pulse rounded bg-muted" /> : <p className="mt-2 text-sm text-muted-foreground">{trial?.isActive ? `MeuPlantão Pro válido até ${new Date(trial.currentPeriodEnd!).toLocaleDateString("pt-BR")}` : trial?.isTrialing ? `Teste grátis: ${trial.daysRemaining} dias restantes` : "Teste grátis encerrado"}</p>}</section>
      <nav aria-label="Atalhos da conta" className="flex flex-wrap gap-3"><Link className={buttonVariants({ variant: "outline" })} href="/assinatura">Assinatura</Link><Link className={buttonVariants({ variant: "outline" })} href="/suporte">Suporte</Link><Button variant="outline" onClick={() => void signOut()}>Sair da conta</Button></nav>
    </Card></div>;
}
