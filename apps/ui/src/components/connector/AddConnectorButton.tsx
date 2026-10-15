import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { AddConnectorModal } from './AddConnectorModal';

export function AddConnectorButton() {
  return (
    <AddConnectorModal>
      <Button type="button" className="h-10 px-6">
        <Plus aria-hidden="true" />
        Add Connector
      </Button>
    </AddConnectorModal>
  );
}
