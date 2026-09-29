import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Recuperar Senha | MeuPlantão",
  description: "Recupere o acesso à sua conta MeuPlantão.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function EsqueciSenhaLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
