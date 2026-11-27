import { Button } from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/common/drawer.js';
import { PlusIcon } from '@/components/common/icons';
import { useWorkingTenant } from '@/lib/tenant/active-tenant';

import { AddConnectorForm } from './add-connector-form.js';
import { useCreateConnectorForm } from './use-create-connector-form.js';

export function AddConnectorDrawer() {
  const { t } = useTranslation();
  const { tenant } = useWorkingTenant();
  const [open, setOpen] = useState(false);
  const { mutation, errors, submit, reset } = useCreateConnectorForm({
    tenantId: tenant?.id,
    onCreated: () => setOpen(false),
  });

  function changeOpen(nextOpen: boolean) {
    if (mutation.isPending) return;
    reset();
    setOpen(nextOpen);
  }

  return (
    <>
      <Button onPress={() => changeOpen(true)}>
        <PlusIcon className="size-5" />
        {t('connectors.add')}
      </Button>
      <Drawer
        open={open}
        onOpenChange={changeOpen}
        dismissible={!mutation.isPending}
      >
        <DrawerContent showCloseButton={!mutation.isPending}>
          <DrawerHeader>
            <DrawerTitle>{t('connectors.form.title')}</DrawerTitle>
          </DrawerHeader>
          <AddConnectorForm
            onSubmit={submit}
            onCancel={() => changeOpen(false)}
            errors={errors}
            mutation={mutation}
            canCreate={Boolean(tenant)}
          />
        </DrawerContent>
      </Drawer>
    </>
  );
}
