import { safeNext } from "@/lib/auth/redirect";
import Link from "next/link";
import { AuthForm } from "@/lib/auth/auth-forms";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next);
  return <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-8"><section className="w-full max-w-md space-y-6 rounded-xl border bg-background p-6 shadow-sm sm:p-8"><div className="space-y-2 text-center"><p className="text-sm font-semibold text-primary">MeuPlantao</p><h1 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h1><p className="text-sm text-muted-foreground">Entre para acompanhar seus plantões.</p></div><AuthForm mode="login" next={next} /><p className="text-center text-sm text-muted-foreground">Ainda não tem uma conta? <Link href={`/cadastro?next=${encodeURIComponent(next)}`} className="font-medium text-foreground underline underline-offset-4">Cadastre-se</Link></p></section></main>;
}
