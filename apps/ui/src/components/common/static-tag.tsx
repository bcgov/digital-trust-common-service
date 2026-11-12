import type { Tag } from '@bcgov/design-system-react-components';
import type { ComponentProps, ReactNode } from 'react';

export type StaticTagColor = ComponentProps<typeof Tag>['color'];

// BCDS Tag styling on a plain span. The BCDS `Tag` only renders inside a
// `TagGroup`, an interactive grid that makes every label a Tab stop.
export function StaticTag({
  label,
  color,
  tagStyle = 'rectangular',
  icon,
}: {
  label: string;
  color: StaticTagColor;
  tagStyle?: 'rectangular' | 'circular';
  icon?: ReactNode;
}) {
  return (
    <span
      className={`bcds-react-aria-Tag ${color} ${tagStyle} small static-tag`}
    >
      {icon}
      <span className="bcds-react-aria-Tag--Label">{label}</span>
    </span>
  );
}
