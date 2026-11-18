import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MeuPlantão",
    short_name: "MeuPlantão",
    description:
      "Organize seus plantões, locais de trabalho e pagamentos. Acompanhe valores a receber, saldo e atrasos em um só lugar.",
    lang: "pt-BR",
    dir: "ltr",
    start_url: "/?origem=twa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F7FAF9",
    theme_color: "#008A4B",
    categories: ["medical", "finance", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
