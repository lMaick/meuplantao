import type { ComponentProps } from "react";
import { StatCard as BaseStatCard } from "./primitives";

/**
 * StatCard (MAI-115): envolve o primitivo com `min-w-0` para que o card possa
 * encolher dentro de grids responsivos (grid items têm min-width:auto por
 * padrão, o que impede o shrink e corta o último card no desktop).
 */
export function StatCard(props: ComponentProps<typeof BaseStatCard>) {
  return (
    <div className="min-w-0">
      <BaseStatCard {...props} />
    </div>
  );
}
