"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Contact,
  House,
  LogOut,
  MapPin,
  Menu,
  Plus,
  Settings,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/lib/auth/logout-button";
import { useFocusTrap } from "@/lib/accessibility/use-focus-trap";

const primary = [
  { href: "/dashboard", label: "Início", short: "Início", icon: House },
  { href: "/calendario", label: "Agenda", short: "Agenda", icon: CalendarDays },
  { href: "/pagamentos", label: "A Receber", short: "Receber", icon: CircleDollarSign },
  { href: "/historico", label: "Histórico", short: "Histórico", icon: Clock3 },
];

const secondary = [
  { href: "/locais", label: "Locais de Trabalho", icon: MapPin },
  { href: "/contatos", label: "Contatos e Escalas", icon: Contact },
  { href: "/perfil", label: "Meu Perfil", icon: UserRound },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(drawerOpen, drawerRef);

  // Close drawer on Escape key and prevent background scroll when open
  useEffect(() => {
    if (!drawerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  if (["/login", "/cadastro"].includes(pathname)) return <>{children}</>;
  if (pathname === "/") return <>{children}</>;

  const active = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Desktop Sidebar (z-30) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border/80 bg-background/95 backdrop-blur-md px-4 py-6 lg:flex">
        <Link
          href="/dashboard"
          className="mb-8 flex items-center gap-3 px-3 text-lg font-bold tracking-tight text-foreground focus-visible:outline-ring group"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 font-bold text-white shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
            M
          </span>
          <span className="flex items-center gap-1.5">
            MeuPlantão
            <span className="size-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
          </span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1.5" aria-label="Navegação principal">
          <Link
            href="/calendario?novo=1"
            className="mb-4 flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-emerald-700/20 transition-all hover:from-emerald-500 hover:to-teal-500 hover:shadow-lg focus-visible:outline-ring active:scale-[0.98]"
          >
            <Plus className="size-4 stroke-[2.5]" />
            Novo plantão
          </Link>
          {primary.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={cn(
                "flex min-h-[44px] items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all",
                active(href)
                  ? "bg-primary/10 font-semibold text-primary border-l-2 border-primary shadow-xs"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              )}
            >
              <Icon className="size-4.5 shrink-0" />
              {label}
            </Link>
          ))}
          <p className="mb-1 mt-6 px-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Gerenciamento
          </p>
          {secondary.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={cn(
                "flex min-h-[44px] items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all",
                active(href)
                  ? "bg-primary/10 font-semibold text-primary border-l-2 border-primary shadow-xs"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              )}
            >
              <Icon className="size-4.5 shrink-0" />
              {label}
            </Link>
          ))}
          <div className="mt-auto border-t border-border/80 pt-4">
            <LogoutButton />
          </div>
        </nav>
      </aside>

      {/* Mobile Top Header (z-20) */}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/80 bg-background/95 px-4 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md lg:hidden">
        <Link
          href="/dashboard"
          className="flex min-h-[44px] items-center gap-2.5 font-bold tracking-tight text-foreground group"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 font-bold text-white shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
            M
          </span>
          <span className="text-base font-bold flex items-center gap-1.5">
            MeuPlantão
            <span className="size-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
          </span>
        </Link>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Abrir menu de opções"
          className="size-11 min-h-[44px] min-w-[44px] rounded-xl text-foreground hover:bg-muted active:bg-muted/80"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="size-6" />
        </Button>
      </header>

      {/* Mobile Slide-Out Sheet Drawer (z-50) */}
      {drawerOpen && (
        <div
           className="motion-overlay-in fixed inset-0 z-50 bg-black/40 backdrop-blur-xs transition-opacity duration-300 lg:hidden"
          onClick={() => setDrawerOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Menu de opções"
        >
          <div
            ref={drawerRef}
            tabIndex={-1}
            className="motion-drawer-in ml-auto flex h-full w-80 max-w-[85vw] flex-col bg-background p-6 shadow-2xl transition-transform duration-300 ease-out pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/80 pb-4">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 font-bold text-white text-sm shadow-xs">
                  M
                </span>
                <span className="font-semibold text-foreground">Menu</span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Fechar menu"
                className="size-11 min-h-[44px] min-w-[44px] rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="size-5" />
              </Button>
            </div>

            <nav className="mt-5 flex flex-1 flex-col overflow-y-auto space-y-1" aria-label="Menu secundário">
              <p className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cadastros & Ajustes
              </p>
              {secondary.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active(href) ? "page" : undefined}
                  className={cn(
                    "flex min-h-[44px] items-center gap-3.5 rounded-xl px-3.5 py-3 text-sm font-medium transition-colors",
                    active(href)
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80"
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  {label}
                </Link>
              ))}

              <div className="mt-auto border-t border-border/80 pt-4">
                <div className="flex items-center gap-3 px-2 py-1 text-sm text-muted-foreground">
                  <LogOut className="size-5 shrink-0" />
                  <div className="flex-1 [&_button]:min-h-[44px] [&_button]:w-full [&_button]:justify-center">
                    <LogoutButton />
                  </div>
                </div>
              </div>
            </nav>
          </div>
        </div>
      )}

      {/* Main Container (pb-28 lg:pb-8 prevents bottom bar occlusion) */}
      <main className="min-h-screen pb-28 lg:ml-64 lg:pb-8">
        {children}
      </main>

      {/* Mobile Bottom Navigation Bar (z-30) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(4.25rem+env(safe-area-inset-bottom,0px))] grid-cols-5 border-t border-border/80 bg-background/95 px-1 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] shadow-[0_-1px_3px_rgba(0,0,0,0.05)] backdrop-blur-md lg:hidden"
        aria-label="Navegação móvel"
      >
        {primary.map(({ href, short, icon: Icon }) => {
          const isActive = active(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group flex h-full min-h-[44px] w-full flex-col items-center justify-center select-none py-1 px-0.5 text-center touch-manipulation transition-colors",
                isActive
                  ? "font-semibold text-primary"
                  : "text-muted-foreground hover:text-foreground active:text-primary"
              )}
            >
              <div
                className={cn(
                  "grid size-7 place-items-center rounded-full transition-transform group-active:scale-90",
                  isActive && "bg-primary/15 ring-1 ring-primary/30"
                )}
              >
                <Icon
                  className={cn(
                    "size-5 transition-transform",
                    isActive ? "stroke-[2.5]" : "stroke-2"
                  )}
                />
              </div>
              <span className="mt-0.5 max-w-full truncate text-[0.65rem] leading-none tracking-tight">
                {short}
              </span>
            </Link>
          );
        })}

        {/* 5th Navigation Item: Novo Plantão Quick Action */}
        <Link
          href="/calendario?novo=1"
          aria-label="Cadastrar novo plantão"
          className="group flex h-full min-h-[44px] w-full flex-col items-center justify-center select-none py-1 px-0.5 text-center touch-manipulation transition-colors"
        >
          <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-md shadow-emerald-500/25 transition-transform group-active:scale-90">
            <Plus className="size-4 stroke-[2.5]" />
          </span>
          <span className="mt-0.5 max-w-full truncate text-[0.65rem] font-semibold text-primary leading-none tracking-tight">
            Novo Plantão
          </span>
        </Link>
      </nav>
    </div>
  );
}
