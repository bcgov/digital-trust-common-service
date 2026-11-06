import type { ReactNode } from 'react';

// Page title, subtitle and actions, per the tenants page Figma frame.
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-xsmall">
      <div className="flex flex-wrap items-center justify-between gap-medium">
        <h1 className="text-h1 font-bold text-black">{title}</h1>
        {actions}
      </div>
      {subtitle && (
        <p className="py-hair text-body text-(--typography-color-secondary)">
          {subtitle}
        </p>
      )}
    </div>
  );
}
