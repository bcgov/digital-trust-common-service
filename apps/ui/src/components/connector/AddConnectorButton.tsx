import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { AddConnectorDrawer } from './AddConnectorDrawer';

export function AddConnectorButton() {
  return (
    <AddConnectorDrawer>
      <Button type="button" className="h-10 px-6">
        <Plus aria-hidden="true" />
        Add Connector
      </Button>
    </AddConnectorDrawer>
  );
}
