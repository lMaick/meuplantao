import type { NextConfig } from "next";
import { buildCspReportOnlyValue, CSP_REPORT_ONLY_HEADER } from "./src/lib/security/csp";

const privateNoIndexPaths = [
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
          // Report-Only: observar violações no console sem bloquear. A promoção
          // para `Content-Security-Policy` efetiva ocorre em follow-up após
          // período de observação (ver docs/operations/csp-report-only.md).
          { key: CSP_REPORT_ONLY_HEADER, value: buildCspReportOnlyValue() },
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
