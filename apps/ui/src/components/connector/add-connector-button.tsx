import { AddActionButton } from '@/components/common/add-action-button';

import { AddConnectorDrawer } from './add-connector-drawer';

export function AddConnectorButton() {
  return (
    <AddConnectorDrawer>
      <AddActionButton>Add Connector</AddActionButton>
    </AddConnectorDrawer>
  );
}
