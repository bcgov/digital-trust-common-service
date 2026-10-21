import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/common/card';

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
