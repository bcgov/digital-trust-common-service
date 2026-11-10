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
import type { ApiClient } from '@/lib/api/resources/api-clients';

export function ApiClientDetailsDrawer({
  client,
  onClose,
}: {
  client: ApiClient;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('apiClients.details.title')}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          <dl className="divide-y divide-(--surface-color-border-default) border-y border-(--surface-color-border-default) text-small-body [&>div]:grid [&>div]:gap-x-6 [&>div]:gap-y-1.5 [&>div]:py-4 [&>div]:sm:grid-cols-[7rem_minmax(0,1fr)] [&_dd]:min-w-0 [&_dd]:text-(--typography-color-secondary) [&_dt]:font-bold [&_dt]:text-(--typography-color-primary)">
            <div>
              <dt>{t('apiClients.details.name')}</dt>
              <dd>{client.name}</dd>
            </div>
            <div>
              <dt>{t('apiClients.fields.clientId')}</dt>
              <dd className="break-all font-mono">{client.client_id}</dd>
            </div>
            <div>
              <dt>{t('apiClients.details.authentication')}</dt>
              <dd className="space-y-1.5">
                <StaticTag
                  color="grey"
                  label={t(
                    client.is_public
                      ? 'apiClients.details.publicClient'
                      : 'apiClients.details.confidentialClient',
                  )}
                />
                <p>
                  {client.is_public
                    ? t('apiClients.details.publicDescription')
                    : t('apiClients.details.confidentialDescription')}
                </p>
              </dd>
            </div>
            <div>
              <dt>{t('apiClients.details.status')}</dt>
              <dd>
                {t(
                  client.revoked_at
                    ? 'apiClients.table.disabled'
                    : 'apiClients.table.enabled',
                )}
              </dd>
            </div>
            <div>
              <dt>{t('apiClients.fields.scopes')}</dt>
              <dd>
                {client.scopes?.length ? (
                  <div className="flex flex-wrap gap-xsmall">
                    {client.scopes.map((scope) => (
                      <StaticTag key={scope} color="blue" label={scope} />
                    ))}
                  </div>
                ) : (
                  t('apiClients.details.none')
                )}
              </dd>
            </div>
            <div>
              <dt>{t('apiClients.fields.grantTypes')}</dt>
              <dd className="break-words">
                {client.grant_types?.length
                  ? client.grant_types
                      .map((grant) => {
                        switch (grant) {
                          case 'client_credentials':
                            return t('apiClients.grantTypes.clientCredentials');
                          case 'authorization_code':
                            return t('apiClients.grantTypes.authorizationCode');
                          case 'refresh_token':
                            return t('apiClients.grantTypes.refreshToken');
                          default:
                            return t('apiClients.grantTypes.other', { grant });
                        }
                      })
                      .join(', ')
                  : t('apiClients.details.none')}
              </dd>
            </div>
            <div>
              <dt>{t('apiClients.fields.redirectUris')}</dt>
              <dd className="break-all">
                {client.redirect_uris?.length
                  ? client.redirect_uris.join(', ')
                  : t('apiClients.details.none')}
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
