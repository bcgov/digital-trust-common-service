import type { ReactNode } from 'react';

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Clear messaging for a route or section the caller's role/scope cannot use.
 *
 * Deliberately not `role="alert"`: a caller without the required scope is
 * the expected outcome of normal navigation (readonly viewing a tenant,
 * a URL for a tenant the token isn't bound to), not a failure that should
 * interrupt assistive tech the way an unexpected error does.
 */
export function AccessDenied({
  title,
  description,
}: {
  title: string;
  description: ReactNode;
}) {
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
