import { Button } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/common/drawer';
import { StaticTag } from '@/components/common/static-tag';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';
import type { IssuanceProfile } from '@/lib/api/resources/issuance-profiles';

export function IssuanceProfileDetailsDrawer({
  profile,
  definition,
  onClose,
}: {
  profile: IssuanceProfile;
  definition: CredentialDefinition | undefined;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const rules = Object.entries(profile.claims?.properties ?? {});
  const definitionName = definition?.name
    ? `${definition.name}${definition.version ? ` (${definition.version})` : ''}`
    : (profile.credential_definition_id ?? t('issuanceProfiles.unavailable'));

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('issuanceProfiles.details.title')}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          <dl className="divide-y divide-(--surface-color-border-default) border-y border-(--surface-color-border-default) text-small-body [&>div]:space-y-1.5 [&>div]:py-4 [&_dd]:min-w-0 [&_dd]:break-words [&_dd]:text-(--typography-color-secondary) [&_dt]:font-bold [&_dt]:text-(--typography-color-primary)">
            <div>
              <dt>{t('credentialDefinitions.table.name')}</dt>
              <dd>{profile.name ?? t('issuanceProfiles.unavailable')}</dd>
            </div>
            <div>
              <dt>{t('credentialDefinitions.table.version')}</dt>
              <dd>{profile.version ?? t('issuanceProfiles.unavailable')}</dd>
            </div>
            {profile.description && (
              <div>
                <dt>{t('credentialDefinitions.review.description')}</dt>
                <dd>{profile.description}</dd>
              </div>
            )}
            <div>
              <dt>{t('issuanceProfiles.definition')}</dt>
              <dd>{definitionName}</dd>
            </div>
            <div>
              <dt>{t('issuanceProfiles.protocol')}</dt>
              <dd>
                {profile.delivery?.protocol
                  ? t(`issuanceProfiles.protocols.${profile.delivery.protocol}`)
                  : t('issuanceProfiles.unavailable')}
              </dd>
            </div>
            <div>
              <dt>{t('credentialDefinitions.table.status')}</dt>
              <dd>
                {profile.status ? (
                  <StaticTag
                    color={
                      profile.status === 'published'
                        ? 'green'
                        : profile.status === 'draft'
                          ? 'yellow'
                          : 'grey'
                    }
                    label={t(`issuanceProfiles.statuses.${profile.status}`)}
                  />
                ) : (
                  t('issuanceProfiles.unavailable')
                )}
              </dd>
            </div>
            <div>
              <dt>{t('issuanceProfiles.create.requiredClaims')}</dt>
              <dd>
                {profile.claims?.required?.length
                  ? new Intl.ListFormat(i18n.language).format(
                      profile.claims.required,
                    )
                  : t('issuanceProfiles.wizard.none')}
              </dd>
            </div>
            <div>
              <dt>{t('issuanceProfiles.valueRules.title')}</dt>
              <dd>
                {rules.length ? (
                  <ul className="space-y-3">
                    {rules.map(([name, rule]) => (
                      <li key={name}>
                        <strong>{name}</strong>
                        {rule.enum && (
                          <p>
                            {t('issuanceProfiles.valueRules.modes.enum')}:{' '}
                            {new Intl.ListFormat(i18n.language).format(
                              rule.enum.map((value) => JSON.stringify(value)),
                            )}
                          </p>
                        )}
                        {rule.const !== undefined && (
                          <p>
                            {t('issuanceProfiles.valueRules.modes.const')}:{' '}
                            {JSON.stringify(rule.const)}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  t('issuanceProfiles.wizard.none')
                )}
              </dd>
            </div>
          </dl>
        </DrawerBody>
        <DrawerFooter className="shrink-0">
          <Button variant="secondary" onPress={onClose}>
            {t('common.close')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
