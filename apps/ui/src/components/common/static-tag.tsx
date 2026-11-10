import type { Tag } from '@bcgov/design-system-react-components';
import type { ComponentProps } from 'react';

export type StaticTagColor = ComponentProps<typeof Tag>['color'];

// BCDS Tag styling on a plain span. The BCDS `Tag` only renders inside a
// `TagGroup`, an interactive grid that makes every label a Tab stop.
export function StaticTag({
  label,
  color,
  tagStyle = 'rectangular',
}: {
  label: string;
  color: StaticTagColor;
  tagStyle?: 'rectangular' | 'circular';
}) {
  return (
    <span
      className={`bcds-react-aria-Tag ${color} ${tagStyle} small static-tag`}
    >
      <span className="bcds-react-aria-Tag--Label">{label}</span>
    </span>
  );
}
