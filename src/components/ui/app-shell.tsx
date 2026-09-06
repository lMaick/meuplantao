"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, CircleDollarSign, Clock3, Contact, House, LogOut, MapPin, Menu, Plus, Settings, UserRound, X } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/lib/auth/logout-button";

const primary = [
  { href: "/dashboard", label: "Início", short: "Início", icon: House },
  { href: "/calendario", label: "Agenda", short: "Agenda", icon: CalendarDays },
  { href: "/pagamentos", label: "A Receber", short: "Receber", icon: CircleDollarSign },
  { href: "/historico", label: "Histórico", short: "Histórico", icon: Clock3 },
];
const more = [
  { href: "/locais", label: "Locais", icon: MapPin },
  { href: "/contatos", label: "Contatos", icon: Contact },
  { href: "/perfil", label: "Perfil", icon: UserRound },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (["/login", "/cadastro"].includes(pathname)) return <>{children}</>;
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return <div className="min-h-screen bg-muted/30">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-background px-4 py-6 lg:flex">
      <Link href="/dashboard" className="mb-8 flex items-center gap-3 px-3 text-lg font-bold tracking-tight"><span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">M</span> MeuPlantao</Link>
      <nav className="flex flex-1 flex-col gap-1" aria-label="Navegação principal">
        <Link href="/calendario?novo=1" className="mb-5 flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"><Plus className="size-4" />Novo plantão</Link>
        {primary.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium", active(href) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="size-4" />{label}</Link>)}
        <p className="mb-1 mt-7 px-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Mais</p>
        {more.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium", active(href) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="size-4" />{label}</Link>)}
        <div className="mt-auto border-t pt-4"><LogoutButton /></div>
      </nav>
    </aside>
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden"><Link href="/dashboard" className="flex items-center gap-2 font-bold"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">M</span> MeuPlantao</Link><Button size="icon" variant="ghost" aria-label="Abrir menu" onClick={() => setOpen(true)}><Menu /></Button></header>
    {open && <div className="fixed inset-0 z-50 bg-black/30 lg:hidden" onClick={() => setOpen(false)}><div className="ml-auto flex h-full w-80 max-w-[88vw] flex-col bg-background p-5" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-between"><span className="font-semibold">Menu</span><Button size="icon" variant="ghost" aria-label="Fechar menu" onClick={() => setOpen(false)}><X /></Button></div><nav className="mt-6 space-y-1">{[...primary, ...more].map(({ href, label, icon: Icon }) => <Link onClick={() => setOpen(false)} key={href} href={href} className={cn("flex items-center gap-3 rounded-xl px-3 py-3 text-sm", active(href) && "bg-primary/10 text-primary")}><Icon className="size-4" />{label}</Link>)}<div className="mt-4 flex items-center gap-3 border-t px-3 py-4 text-sm text-muted-foreground"><LogOut className="size-4" /><LogoutButton /></div></nav></div></div>}
    <main className="min-h-screen pb-24 lg:ml-64 lg:pb-0">{children}</main>
    <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[4.5rem] grid-cols-5 border-t bg-background px-1 pb-1 lg:hidden" aria-label="Navegação móvel">{primary.map(({ href, short, icon: Icon }) => <Link key={href} href={href} className={cn("flex flex-col items-center justify-center gap-1 text-[0.68rem] text-muted-foreground", active(href) && "font-semibold text-primary")}><Icon className="size-5" />{short}</Link>)}<Link href="/calendario?novo=1" className="flex flex-col items-center justify-center gap-1 text-[0.68rem] font-semibold text-primary"><span className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground"><Plus className="size-4" /></span>Plantão</Link></nav>
  </div>;
}
