/**
 * Small presentational kit for the super-admin panel.
 *
 * Deliberately not a second design system: every piece here is a thin
 * composition of the same Tailwind tokens the tenant app uses, so the
 * panel inherits light/dark and the Arabic type scale for free. Density
 * is higher than the tenant UI — this is a console, not a workspace.
 */

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function AdminCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('border-border bg-card rounded-xl border', className)}
    >
      {(title || actions) && (
        <header className="border-border flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-foreground text-sm font-semibold">{title}</h2>
            ) : null}
            {description ? (
              <p className="text-muted-foreground mt-0.5 text-xs">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONE: Record<string, string> = {
  neutral: 'border-border bg-muted text-foreground/75',
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  bad: 'border-red-500/40 bg-red-500/10 text-red-500',
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-500',
};

export function Chip({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: keyof typeof TONE;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        TONE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: keyof typeof TONE;
}) {
  const accent =
    tone === 'bad'
      ? 'text-red-500'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'ok'
          ? 'text-emerald-500'
          : 'text-foreground';
  return (
    <div className="border-border bg-card rounded-xl border px-4 py-3">
      <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {label}
      </div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', accent)}>
        {value}
      </div>
      {hint ? (
        <div className="text-muted-foreground mt-1 text-xs">{hint}</div>
      ) : null}
    </div>
  );
}

/** Dense table shell: the panel is mostly tables, so it gets a convention. */
export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-border text-muted-foreground border-b text-[11px] tracking-wide uppercase">
        {children}
      </tr>
    </thead>
  );
}

export function TH({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th className={cn('px-2 py-2 text-start font-medium', className)}>
      {children}
    </th>
  );
}

export function TD({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <td className={cn('px-2 py-2 align-middle', className)}>{children}</td>
  );
}

export function EmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="text-muted-foreground px-2 py-8 text-center text-sm"
      >
        {children}
      </td>
    </tr>
  );
}
