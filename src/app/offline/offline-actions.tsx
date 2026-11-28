"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";

export function OfflineActions() {
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
      <Button
        type="button"
        size="lg"
        onClick={() => window.location.reload()}
        className="min-h-[44px] w-full sm:w-auto gap-2 rounded-xl bg-emerald-600 px-6 font-semibold text-white hover:bg-emerald-500 active:scale-[0.99] motion-reduce:transition-none cursor-pointer"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        Tentar novamente
      </Button>
      <Link
        href="/dashboard"
        className={cn(
          buttonVariants({ variant: "outline", size: "lg" }),
          "min-h-[44px] w-full sm:w-auto rounded-xl font-medium motion-reduce:transition-none",
        )}
      >
        Ir para o início
      </Link>
    </div>
  );
}
