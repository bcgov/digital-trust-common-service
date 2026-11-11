import {
  AlertDialog,
  Button,
  Modal,
} from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import { MutationError } from '@/components/common/form-dialog';
import { notify } from '@/components/common/sonner';
import { ApiError } from '@/lib/api/errors';
import {
  useArchiveIssuanceProfile,
  useDeleteIssuanceProfile,
} from '@/lib/api/queries/issuance-profiles';
import {
  IssuanceProfileLifecycleAction,
  type IssuanceProfile,
} from '@/lib/api/resources/issuance-profiles';

export function ArchiveOrDeleteIssuanceProfileDialog({
  action,
  profile,
  tenantId,
  onClose,
  onArchive,
}: {
  action: IssuanceProfileLifecycleAction;
  profile: IssuanceProfile;
  tenantId: string;
  onClose: () => void;
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const archive = useArchiveIssuanceProfile(tenantId);
  const remove = useDeleteIssuanceProfile(tenantId);
  const mutation =
    action === IssuanceProfileLifecycleAction.DELETE ? remove : archive;
  const title = t(`issuanceProfiles.${action}.title`);
  const usedConflict =
    action === IssuanceProfileLifecycleAction.DELETE &&
    mutation.error instanceof ApiError &&
    mutation.error.status === 409;

  return (
    <Modal
      isOpen
      isDismissable={!mutation.isPending}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
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
            isDisabled={mutation.isPending}
            onPress={onClose}
          >
            {t('common.cancel')}
          </Button>,
          usedConflict && profile.status === 'published' ? (
            <Button key="archive" onPress={onArchive}>
              {t('issuanceProfiles.archive.title')}
            </Button>
          ) : (
            <Button
              key="confirm"
              danger
              isDisabled={mutation.isPending || !profile.id || usedConflict}
              onPress={() => {
                if (!profile.id || mutation.isPending || usedConflict) return;
                mutation.mutate(profile.id, {
                  onSuccess: () => {
                    notify.success(t(`issuanceProfiles.${action}.saved`));
                    onClose();
                  },
                });
              }}
            >
              {mutation.isPending
                ? t(`issuanceProfiles.${action}.pending`)
                : title}
            </Button>
          ),
        ]}
      >
        <p>
          {t(`issuanceProfiles.${action}.body`, {
            name: profile.name,
            version: profile.version,
          })}
        </p>
        <MutationError
          error={mutation.error}
          conflict={t(`issuanceProfiles.${action}.conflict`)}
        />
      </AlertDialog>
    </Modal>
  );
}
