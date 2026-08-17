import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function PlaceholderPage({
  title,
  issue,
}: {
  title: string;
  issue?: number;
}) {
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Coming soon{issue ? ` — tracked in #${issue}` : ''}.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
