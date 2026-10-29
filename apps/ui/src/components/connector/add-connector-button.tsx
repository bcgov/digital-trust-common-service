import { useTranslation } from 'react-i18next';

import { AddActionButton } from '@/components/common/add-action-button';

import { AddConnectorDrawer } from './add-connector-drawer';

export function AddConnectorButton() {
  const { t } = useTranslation();

  return (
    <AddConnectorDrawer>
      <AddActionButton>{t('connectors.add')}</AddActionButton>
    </AddConnectorDrawer>
  );
}
