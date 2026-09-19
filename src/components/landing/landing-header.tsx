"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, Menu, X } from "lucide-react";

interface LandingHeaderProps {
  isLoggedIn?: boolean;
}

export function LandingHeader({ isLoggedIn }: LandingHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/80 bg-background/90 backdrop-blur-md transition-all">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight text-foreground group">
          <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs transition-transform group-hover:scale-105">
            <Activity className="size-5 stroke-[2.2]" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-lg font-bold tracking-tight text-foreground">MeuPlantão</span>
            <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Gestão Médica</span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden items-center gap-8 md:flex" aria-label="Navegação do site">
          <Link
            href="#como-funciona"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Como Funciona
          </Link>
          <Link
            href="#demonstracao"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Demonstração
          </Link>
          <Link
            href="#calculadora"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Calculadora
          </Link>
          <Link
            href="#preco"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Preço
          </Link>
          <Link
            href="#perguntas"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Dúvidas
          </Link>
        </nav>

        {/* Desktop CTA */}
        <div className="hidden items-center gap-3 md:flex">
          {isLoggedIn ? (
            <Link
              href="/dashboard"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background shadow-xs transition-all hover:bg-foreground/90"
            >
              Ir para o Painel
              <ArrowRight className="size-4" />
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
              >
                Entrar
              </Link>
              <Link
                href="/cadastro"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-xs transition-all hover:bg-emerald-500 hover:shadow-sm active:scale-98"
              >
                Cadastrar Grátis
                <ArrowRight className="size-4" />
              </Link>
            </>
          )}
        </div>

        {/* Mobile Menu Button */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="flex size-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted md:hidden"
          aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
        >
          {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="border-b border-border bg-background px-4 pt-2 pb-6 md:hidden">
          <nav className="flex flex-col gap-3">
            <Link
              href="#como-funciona"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-muted-foreground hover:bg-muted"
            >
              Como Funciona
            </Link>
            <Link
              href="#demonstracao"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-muted-foreground hover:bg-muted"
            >
              Demonstração
            </Link>
            <Link
              href="#calculadora"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-muted-foreground hover:bg-muted"
            >
              Calculadora de Repasses
            </Link>
            <Link
              href="#perguntas"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-muted-foreground hover:bg-muted"
            >
              Perguntas Frequentes
            </Link>
            <Link
              href="#preco"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-muted-foreground hover:bg-muted"
            >
              Preço
            </Link>

            <div className="mt-4 flex flex-col gap-2 pt-4 border-t border-border">
              {isLoggedIn ? (
                <Link
                  href="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex h-11 items-center justify-center rounded-xl bg-foreground text-sm font-semibold text-background"
                >
                  Acessar Painel
                </Link>
              ) : (
                <>
                  <Link
                    href="/cadastro"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex h-11 items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-xs"
                  >
                    Começar Gratuitamente
                  </Link>
                  <Link
                    href="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex h-11 items-center justify-center rounded-xl border border-border text-sm font-medium text-muted-foreground"
                  >
                    Já tenho conta (Entrar)
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
