import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';

export function PlaceholderPage({
  title,
  issue,
}: {
  title: ParseKeys;
  issue?: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-lg flex-col gap-(--layout-margin-xsmall) rounded-(--layout-border-radius-large) border border-(--surface-color-border-default) bg-(--surface-color-background-white) p-(--layout-padding-medium)">
      <p className="text-body font-bold text-black">{t(title)}</p>
      <p className="text-small-body text-(--typography-color-secondary)">
        {issue
          ? t('placeholder.comingSoonTracked', { issue })
          : t('placeholder.comingSoon')}
      </p>
    </div>
  );
}
