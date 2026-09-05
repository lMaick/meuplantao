"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, background: "#ffffff", color: "#171717", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: "28rem", margin: "auto", padding: "3rem 1rem" }}>
          <p>MeuPlantao</p>
          <h1>Não foi possível abrir o aplicativo</h1>
          <p>Tente novamente. Se o problema continuar, recarregue a página.</p>
          <button onClick={reset} style={{ padding: "0.75rem 1rem", cursor: "pointer" }}>Tentar novamente</button>
        </main>
      </body>
    </html>
  );
}
