"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { logoutAndRedirect } from "./logout";

type LogoutVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";

interface LogoutButtonProps {
  variant?: LogoutVariant;
  className?: string;
  label?: string;
}

export function LogoutButton({ variant = "outline", className, label = "Sair da Conta" }: LogoutButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function handleLogout() {
    if (loading) return;
    setError(false);
    setLoading(true);
    const success = await logoutAndRedirect(() => createClient().auth.signOut(), (path) => {
      router.replace(path);
      router.refresh();
    });
    if (!success) {
      setError(true);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={variant}
        onClick={handleLogout}
        disabled={loading}
        aria-label={label}
        aria-busy={loading}
        data-testid="logout-button"
        className={cn("min-h-[44px] w-full touch-manipulation sm:w-auto", className)}
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Saindo...
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <LogOut className="size-4 shrink-0" aria-hidden="true" />
            {label}
          </span>
        )}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível sair. Tente novamente.
        </p>
      )}
    </div>
  );
}
