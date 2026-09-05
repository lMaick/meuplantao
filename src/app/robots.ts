import type { MetadataRoute } from "next";

// Account screens and private financial data have no public search surface.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
