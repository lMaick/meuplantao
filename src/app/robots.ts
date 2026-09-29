import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://meuplantao.com.br";
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacidade", "/termos"],
      disallow: [
        "/cadastro",
        "/login",
        "/esqueci-senha",
        "/redefinir-senha",
        "/suporte",
        "/dashboard",
        "/dashboard/",
        "/calendario",
        "/calendario/",
        "/pagamentos",
        "/pagamentos/",
        "/historico",
        "/historico/",
        "/locais",
        "/locais/",
        "/contatos",
        "/contatos/",
        "/perfil",
        "/perfil/",
        "/configuracoes",
        "/configuracoes/",
        "/api/",
        "/auth/",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
