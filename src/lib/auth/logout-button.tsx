"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { logoutAndRedirect } from "./logout";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function handleLogout() {
    setError(false);
    setLoading(true);
    const success = await logoutAndRedirect(() => createClient().auth.signOut(), (path) => {
      router.replace(path);
      router.refresh();
    });
    if (!success) setError(true);
    setLoading(false);
  }

  return <div className="space-y-2"><Button type="button" variant="outline" onClick={handleLogout} disabled={loading}>{loading ? "Saindo..." : "Sair"}</Button>{error && <p role="alert" className="text-sm text-destructive">Não foi possível sair. Tente novamente.</p>}</div>;
}
