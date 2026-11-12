import {
  AlertDialog,
  Button,
  Modal,
} from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import { MutationError } from '@/components/common/form-dialog';
import { notify } from '@/components/common/sonner';
import { usePublishIssuanceProfile } from '@/lib/api/queries/issuance-profiles';
import type { IssuanceProfile } from '@/lib/api/resources/issuance-profiles';

export function PublishIssuanceProfileDialog({
  profile,
  tenantId,
  onClose,
}: {
  profile: IssuanceProfile;
  tenantId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const publish = usePublishIssuanceProfile(tenantId);
  const title = t('issuanceProfiles.publish.title');

  return (
    <Modal
      isOpen
      isDismissable={!publish.isPending}
      onOpenChange={(open) => {
        if (!open && !publish.isPending) onClose();
      }}
    >
      <AlertDialog
        role="alertdialog"
        aria-label={title}
        title={title}
        buttons={[
          <Button
            key="cancel"
            variant="secondary"
            isDisabled={publish.isPending}
            onPress={onClose}
          >
            {t('common.cancel')}
          </Button>,
          <Button
            key="publish"
            isDisabled={publish.isPending || !profile.id}
            onPress={() => {
              if (!profile.id || publish.isPending) return;
              publish.mutate(profile.id, {
                onSuccess: () => {
                  notify.success(t('issuanceProfiles.publish.saved'));
                  onClose();
                },
              });
            }}
          >
            {publish.isPending ? t('issuanceProfiles.publish.pending') : title}
          </Button>,
        ]}
      >
        <p>
          {t('issuanceProfiles.publish.body', {
            name: profile.name,
            version: profile.version,
          })}
        </p>
        <MutationError
          error={publish.error}
          conflict={t('issuanceProfiles.publish.conflict')}
        />
      </AlertDialog>
    </Modal>
  );
}
