import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";

export function LandingFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-slate-950 text-white">
      {/* Final Call to Action Box */}
      <div className="mx-auto max-w-5xl px-4 pt-16 pb-12 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-900 to-slate-900 p-8 sm:p-12 text-center border border-emerald-800/50 shadow-xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Pronto para colocar ordem nos seus repasses?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base sm:text-lg text-emerald-100/90 leading-relaxed">
            Junte-se a profissionais de saúde que não perdem mais tempo calculando escalas em planilhas ou sofrendo com repasses esquecidos.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/cadastro"
              className="flex h-12 w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-emerald-500 px-8 text-base font-bold text-emerald-950 shadow-md transition-all hover:bg-emerald-400 active:scale-98"
            >
              Criar Conta Gratuita Agora
              <ArrowRight className="size-5" />
            </Link>
            <Link
              href="/login"
              className="flex h-12 w-full sm:w-auto items-center justify-center rounded-xl border border-white/20 bg-white/5 px-8 text-base font-semibold text-white transition-all hover:bg-white/10"
            >
              Já sou cadastrado
            </Link>
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="mt-16 flex flex-col md:flex-row items-center justify-between gap-6 border-t border-slate-900 pt-8 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
              <Activity className="size-4 stroke-[2.5]" />
            </div>
            <span className="font-bold text-sm text-white">MeuPlantão</span>
            <span className="text-slate-600">|</span>
            <span>Controle financeiro inteligente para quem vive de plantão.</span>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <Link href="/login" className="hover:text-white transition-colors">
              Entrar
            </Link>
            <Link href="/cadastro" className="hover:text-white transition-colors">
              Cadastrar
            </Link>
            <Link href="#como-funciona" className="hover:text-white transition-colors">
              Como Funciona
            </Link>
            <Link href="#calculadora" className="hover:text-white transition-colors">
              Calculadora
            </Link>
            <Link href="#preco" className="hover:text-white transition-colors">
              Preço
            </Link>
            <Link href="/privacidade" className="hover:text-white transition-colors">
              Privacidade
            </Link>
            <Link href="/termos" className="hover:text-white transition-colors">
              Termos
            </Link>
            <Link href="/suporte" className="hover:text-white transition-colors">
              Suporte
            </Link>
          </div>
        </div>

        <div className="mt-6 text-center text-[11px] text-slate-400">
          © {currentYear} MeuPlantão. Todos os direitos reservados. Feito com rigor para profissionais de saúde.
        </div>
      </div>
    </footer>
  );
}
