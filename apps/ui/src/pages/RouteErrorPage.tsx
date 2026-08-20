import { Link, useRouteError } from 'react-router';

import { Button } from '@/components/ui/button';

export function RouteErrorPage() {
  const error = useRouteError();
  const message =
    error instanceof Error
      ? error.message
      : 'An unexpected error occurred while rendering.';

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <p className="text-xl font-semibold">Something went wrong</p>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        {message}
      </p>
      <Button asChild variant="outline">
        <Link to="/dashboard" reloadDocument>
          Back to dashboard
        </Link>
      </Button>
    </div>
  );
}
