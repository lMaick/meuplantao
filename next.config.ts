import type { NextConfig } from "next";
import { getCspHeaders } from "./src/lib/security/csp";

const privateNoIndexPaths = [
  "/alertas",
  "/alertas/:path*",
  "/assinatura",
  "/assinatura/:path*",
  "/cadastro",
  "/cadastro/:path*",
  "/login",
  "/login/:path*",
  "/esqueci-senha",
  "/esqueci-senha/:path*",
  "/redefinir-senha",
  "/redefinir-senha/:path*",
  "/suporte",
  "/suporte/:path*",
  "/dashboard",
  "/dashboard/:path*",
  "/calendario",
  "/calendario/:path*",
  "/pagamentos",
  "/pagamentos/:path*",
  "/historico",
  "/historico/:path*",
  "/locais",
  "/locais/:path*",
  "/contatos",
  "/contatos/:path*",
  "/perfil",
  "/perfil/:path*",
  "/configuracoes",
  "/configuracoes/:path*",
  "/api/:path*",
  "/auth/:path*",
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // MAI-145: Report-Only sempre (telemetria via /api/csp-report) +
          // política efetiva somente sob `CSP_ENFORCE=true` (avaliado no build;
          // rollback = remover a flag e redeploy). Ver
          // docs/operations/csp-enforcement.md.
          ...getCspHeaders(),
        ],
      },
      ...privateNoIndexPaths.map((path) => ({
        source: path,
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      })),
    ];
  },
};

export default nextConfig;
