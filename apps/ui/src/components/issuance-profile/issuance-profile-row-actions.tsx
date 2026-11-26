import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Separator,
} from '@bcgov/design-system-react-components';
import { Archive } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  CheckIcon,
  CircleInfoIcon,
  EditIcon,
  EllipsisVerticalIcon,
  TrashIcon,
} from '@/components/common/icons';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';
import { useAuth } from '@/lib/auth/context';
import { hasScope, TENANT_ADMIN_SCOPE } from '@/lib/auth/scopes';
import {
  IssuanceProfileLifecycleAction,
  type IssuanceProfile,
} from '@/lib/api/resources/issuance-profiles';

import { PublishIssuanceProfileDialog } from './publish-issuance-profile-dialog';
import { ArchiveOrDeleteIssuanceProfileDialog } from './archive-or-delete-issuance-profile-dialog';
import { IssuanceProfileDetailsDrawer } from './issuance-profile-details-drawer';

export function IssuanceProfileRowActions({
  profile,
  definition,
  tenantId,
}: {
  profile: IssuanceProfile;
  definition: CredentialDefinition | undefined;
  tenantId: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isViewing, setIsViewing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [lifecycleAction, setLifecycleAction] =
    useState<IssuanceProfileLifecycleAction | null>(null);

  if (!profile.id) return null;
  const canPublish = profile.status === 'draft';
  const canEdit = canPublish && hasScope(user, TENANT_ADMIN_SCOPE);
  const canDelete = profile.can_delete === true;
  const canArchive =
    profile.status === 'published' && profile.can_delete === false;

  return (
    <>
      <MenuTrigger>
        <Button
          variant="tertiary"
          isIconButton
          aria-label={t('issuanceProfiles.actionsFor', {
            name: profile.name,
            version: profile.version,
          })}
        >
          <EllipsisVerticalIcon className="size-5" />
        </Button>
        <Menu
          placement="bottom end"
          className="bcds-react-aria-Menu medium record-menu"
          onAction={(key) => {
            if (key === 'view') setIsViewing(true);
            else if (key === 'edit')
              void navigate(
                `/issuance-profiles/create?id=${encodeURIComponent(profile.id ?? '')}`,
              );
            else if (key === 'publish') setIsPublishing(true);
            else if (key === IssuanceProfileLifecycleAction.ARCHIVE)
              setLifecycleAction(IssuanceProfileLifecycleAction.ARCHIVE);
            else if (key === IssuanceProfileLifecycleAction.DELETE)
              setLifecycleAction(IssuanceProfileLifecycleAction.DELETE);
          }}
        >
          <MenuItem id="view" textValue={t('common.viewDetails')}>
            <CircleInfoIcon className="size-5 shrink-0" />
            {t('common.viewDetails')}
          </MenuItem>
          {canEdit && (
            <MenuItem id="edit" textValue={t('issuanceProfiles.edit.title')}>
              <EditIcon className="size-5 shrink-0" />
              {t('issuanceProfiles.edit.title')}
            </MenuItem>
          )}
          {(canPublish || canDelete || canArchive) && (
            <Separator size="small" />
          )}
          {canPublish && (
            <MenuItem
              id="publish"
              textValue={t('issuanceProfiles.publish.title')}
            >
              <CheckIcon className="size-5 shrink-0" />
              {t('issuanceProfiles.publish.title')}
            </MenuItem>
          )}
          {canPublish && canDelete && <Separator size="small" />}
          {canArchive && (
            <MenuItem
              id={IssuanceProfileLifecycleAction.ARCHIVE}
              textValue={t('issuanceProfiles.archive.title')}
            >
              <Archive className="size-5 shrink-0" />
              {t('issuanceProfiles.archive.title')}
            </MenuItem>
          )}
          {canDelete && (
            <MenuItem
              id={IssuanceProfileLifecycleAction.DELETE}
              textValue={t('issuanceProfiles.delete.title')}
            >
              <TrashIcon className="size-5 shrink-0 text-(--icons-color-danger)" />
              <span className="text-(--typography-color-danger)">
                {t('issuanceProfiles.delete.title')}
              </span>
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>
      {isViewing && (
        <IssuanceProfileDetailsDrawer
          profile={profile}
          definition={definition}
          onClose={() => setIsViewing(false)}
        />
      )}
      {isPublishing && (
        <PublishIssuanceProfileDialog
          tenantId={tenantId}
          profile={profile}
          onClose={() => setIsPublishing(false)}
        />
      )}
      {lifecycleAction && (
        <ArchiveOrDeleteIssuanceProfileDialog
          key={lifecycleAction}
          action={lifecycleAction}
          profile={profile}
          tenantId={tenantId}
          onClose={() => setLifecycleAction(null)}
          onArchive={() =>
            setLifecycleAction(IssuanceProfileLifecycleAction.ARCHIVE)
          }
        />
      )}
    </>
  );
}
