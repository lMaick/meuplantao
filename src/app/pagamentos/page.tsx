import { Suspense } from "react";
import PaymentsPage from "@/components/payments/payments-page";

export default function PagamentosRoute() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-muted-foreground">Carregando recebimentos...</main>}>
      <PaymentsPage />
    </Suspense>
  );
}
