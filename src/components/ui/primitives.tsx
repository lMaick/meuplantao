import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-card text-card-foreground shadow-xs transition-all duration-200",
        className
      )}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card p-5 text-card-foreground shadow-xs transition-all duration-200 hover:shadow-md hover:border-primary/30">
      <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-foreground">{value}</div>
      {detail && <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

export type BadgeVariant =
  | "neutral"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "outline";

export interface BadgeProps extends ComponentProps<"span"> {
  variant?: BadgeVariant;
  tone?: "neutral" | "success" | "warning" | "danger" | "destructive";
  dot?: boolean;
}

export function Badge({
  children,
  variant,
  tone = "neutral",
  dot = false,
  className,
  ...props
}: BadgeProps) {
  const activeVariant: BadgeVariant =
    variant ?? (tone === "danger" ? "destructive" : tone);

  const variantStyles: Record<BadgeVariant, string> = {
    neutral: "bg-muted text-muted-foreground border-border/50",
    success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
    warning: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/25",
    destructive: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25",
    info: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25",
    outline: "border-border text-foreground bg-transparent",
  };

  const dotStyles: Record<BadgeVariant, string> = {
    neutral: "bg-muted-foreground/60",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    destructive: "bg-rose-500",
    info: "bg-sky-500",
    outline: "bg-foreground/50",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-tight transition-colors select-none",
        variantStyles[activeVariant],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("size-1.5 rounded-full shrink-0", dotStyles[activeVariant])}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

export function FinancialStatusBadge({
  status,
  isOverdue = false,
  balance = 0,
  className,
}: {
  status?: "pago" | "recebido" | "a-vencer" | "atrasado" | "agendado" | "realizado" | "cancelado";
  isOverdue?: boolean;
  balance?: number;
  className?: string;
}) {
  if (status === "pago" || status === "recebido" || (status === "realizado" && balance === 0)) {
    return <Badge variant="success" dot className={className}>Pago</Badge>;
  }
  if (status === "atrasado" || isOverdue || (balance > 0 && isOverdue)) {
    return <Badge variant="destructive" dot className={className}>Atrasado</Badge>;
  }
  if (status === "a-vencer" || (!isOverdue && balance > 0)) {
    return <Badge variant="warning" dot className={className}>A vencer</Badge>;
  }
  if (status === "agendado") {
    return <Badge variant="warning" dot className={className}>Agendado</Badge>;
  }
  if (status === "cancelado") {
    return <Badge variant="neutral" dot className={className}>Cancelado</Badge>;
  }
  return <Badge variant="neutral" className={className}>{status}</Badge>;
}

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 min-h-[44px] w-full rounded-lg border border-input bg-background px-3.5 py-2 text-base md:text-sm text-foreground shadow-xs transition-all outline-none",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-11 min-h-[44px] w-full rounded-lg border border-input bg-background px-3.5 py-2 text-base md:text-sm text-foreground shadow-xs transition-all outline-none",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export interface EmptyStateProps extends ComponentProps<"div"> {
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      role="region"
      aria-label={title}
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 text-center text-card-foreground transition-all",
        compact ? "p-5 sm:p-6" : "p-8 sm:p-12",
        className
      )}
      {...props}
    >
      {Icon && (
        <div
          className={cn(
            "mb-3.5 flex items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground ring-1 ring-border/50",
            compact ? "size-10" : "size-12"
          )}
        >
          <Icon className={cn("shrink-0", compact ? "size-5" : "size-6")} aria-hidden="true" />
        </div>
      )}
      <h3
        className={cn(
          "font-semibold tracking-tight text-foreground",
          compact ? "text-sm sm:text-base" : "text-base sm:text-lg"
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            "mt-1.5 max-w-sm text-muted-foreground leading-relaxed",
            compact ? "text-xs" : "text-sm"
          )}
        >
          {description}
        </p>
      )}
      {action && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-center gap-2.5",
            compact ? "mt-4" : "mt-6"
          )}
        >
          {action}
        </div>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted", className)} />;
}

export function Money({ value }: { value: number }) {
  return (
    <span>
      {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)}
    </span>
  );
}

export function DateDisplay({ value }: { value: string | Date }) {
  return (
    <time dateTime={new Date(value).toISOString()}>
      {new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value))}
    </time>
  );
}

export function Dialog({ children, ...props }: ComponentProps<"dialog">) {
  return (
    <dialog
      className="rounded-2xl border bg-background p-6 shadow-xl backdrop:bg-black/30"
      {...props}
    >
      {children}
    </dialog>
  );
}

export function Sheet({ children, className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-50 w-full max-w-md border-l bg-background p-6 shadow-xl",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ConfirmDialog({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Dialog>
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2 text-sm text-muted-foreground">{children}</div>
    </Dialog>
  );
}

export function Toast({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="fixed bottom-24 right-4 z-50 rounded-xl border bg-background px-4 py-3 text-sm shadow-lg sm:bottom-6 sm:right-6"
    >
      {children}
    </div>
  );
}
