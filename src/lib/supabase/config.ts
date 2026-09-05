export function getSupabaseConfig() {
  // Keep direct references so Next.js can inline public variables in the browser.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !key || url.includes("your-project") || key === "your-anon-key") {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return null;
    }
  } catch {
    return null;
  }

  return { url, key };
}

export function requireSupabaseConfig() {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error("Supabase não configurado. Preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY em .env.local e reinicie o servidor. Consulte o README.md.");
  }
  return config;
}
