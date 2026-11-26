import { Button } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { PlusIcon } from '@/components/common/icons';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';

import { eligibleDefinitions } from './eligible-definitions';

export function CreateIssuanceProfileButton({
  definitions,
}: {
  definitions: readonly CredentialDefinition[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canCreate = eligibleDefinitions(definitions).length > 0;

  return (
    <>
      <Button
        isDisabled={!canCreate}
        onPress={() => void navigate('/issuance-profiles/create')}
      >
        <PlusIcon className="size-5" />
        {t('issuanceProfiles.create.title')}
      </Button>
      {!canCreate && (
        <p role="status">{t('issuanceProfiles.create.noDefinitions')}</p>
      )}
    </>
  );
}
