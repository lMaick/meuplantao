import { Suspense } from "react";
import PaymentsPage from "@/components/payments/payments-page";
import { PaymentsSkeleton } from "@/components/ui/skeletons";

export default function PagamentosRoute() {
  return (
    <Suspense fallback={<PaymentsSkeleton />}>
      <PaymentsPage />
    </Suspense>
  );
}

