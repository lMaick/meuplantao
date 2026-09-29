import type { MetadataRoute } from "next";
import { getSiteUrl } from "../lib/seo/site-url";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getSiteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacidade", "/termos"],
      disallow: [
        "/api/",
        "/auth/",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
