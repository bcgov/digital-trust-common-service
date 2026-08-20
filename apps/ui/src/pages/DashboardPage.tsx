import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const PLACEHOLDER_CARDS = [
  {
    title: 'Credential definitions',
    description: 'Count arrives with the tenant dashboard (#84).',
  },
  {
    title: 'Active connections',
    description: 'Count arrives with the tenant dashboard (#84).',
  },
  {
    title: 'Recent operations',
    description: 'List arrives with the tenant dashboard (#84).',
  },
];

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLACEHOLDER_CARDS.map(({ title, description }) => (
          <Card key={title}>
            <CardHeader>
              <CardDescription>{title}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">—</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
