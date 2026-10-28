import {
  AlertDialog,
  Button,
  Modal,
} from '@bcgov/design-system-react-components';

import { MutationError } from '@/components/common/form-dialog';
import { notify } from '@/components/common/sonner';
import { useDeleteTenant } from '@/lib/api/queries/tenants';
import type { Tenant } from '@/lib/api/resources/tenants';

export function DeleteTenantDialog({
  tenant,
  onClose,
}: {
  tenant: Tenant;
  onClose: () => void;
}) {
  const remove = useDeleteTenant();
  const title = 'Delete tenant';

  return (
    <Modal
      isOpen
      isDismissable={!remove.isPending}
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose();
      }}
    >
      <AlertDialog
        variant="destructive"
        role="alertdialog"
        aria-label={title}
        title={title}
        buttons={[
          <Button
            key="cancel"
            variant="secondary"
            isDisabled={remove.isPending}
            onPress={onClose}
          >
            Cancel
          </Button>,
          <Button
            key="confirm"
            danger
            isDisabled={remove.isPending || !tenant.id}
            onPress={() => {
              if (!tenant.id) return;
              remove.mutate(tenant.id, {
                onSuccess: () => {
                  onClose();
                  notify.success(`Tenant ${tenant.name ?? ''} deleted.`);
                },
              });
            }}
          >
            {title}
          </Button>,
        ]}
      >
        <p>
          {tenant.name ?? 'This tenant'} will be deactivated and its members
          will lose access. A platform admin can restore it later.
        </p>
        <MutationError error={remove.error} />
      </AlertDialog>
    </Modal>
  );
}
