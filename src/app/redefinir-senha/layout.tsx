import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Redefinir Senha | MeuPlantão",
  description: "Defina uma nova senha para sua conta MeuPlantão.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RedefinirSenhaLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
