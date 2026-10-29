import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';

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
  title: ParseKeys;
  issue?: number;
}) {
  const { t } = useTranslation();
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>{t(title)}</CardTitle>
        <CardDescription>
          {issue
            ? t('placeholder.comingSoonTracked', { issue })
            : t('placeholder.comingSoon')}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
