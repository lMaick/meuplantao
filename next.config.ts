import type { NextConfig } from "next";
import { buildCspReportOnlyValue, CSP_REPORT_ONLY_HEADER } from "./src/lib/security/csp";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        // Report-Only: observar violações no console sem bloquear. A promoção
        // para `Content-Security-Policy` efetiva ocorre em follow-up após
        // período de observação (ver docs/operations/csp-report-only.md).
        { key: CSP_REPORT_ONLY_HEADER, value: buildCspReportOnlyValue() },
      ],
    }];
  },
};

export default nextConfig;
