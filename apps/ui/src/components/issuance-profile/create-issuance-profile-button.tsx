import { Button } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { PlusIcon } from '@/components/common/icons';

export function CreateIssuanceProfileButton({
  canCreate,
  tenantId,
}: {
  canCreate: boolean;
  tenantId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Button
      isDisabled={!canCreate}
      onPress={() =>
        void navigate(`/tenants/${tenantId}/issuance-profiles/create`)
      }
    >
      <PlusIcon className="size-5" />
      {t('issuanceProfiles.create.title')}
    </Button>
  );
}
