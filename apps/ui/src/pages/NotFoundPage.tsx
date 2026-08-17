import { Link } from 'react-router';

import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <p className="text-6xl font-semibold tabular-nums">404</p>
      <p className="text-muted-foreground">That page does not exist.</p>
      <Button asChild variant="outline">
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
