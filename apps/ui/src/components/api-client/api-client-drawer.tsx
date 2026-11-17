import {
  Button,
  Checkbox,
  CheckboxGroup,
  InlineAlert,
  Menu,
  MenuItem,
  MenuSection,
  MenuSectionHeader,
  MenuTrigger,
  ProgressCircle,
  SvgChevronDownIcon,
  TagGroup,
  TagList,
  TextField,
} from '@bcgov/design-system-react-components';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { PlusIcon, TrashIcon } from '@/components/common/icons';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerFooter,
  DrawerDescription,
} from '@/components/common/drawer';
import {
  useClientScopes,
  useSaveApiClient,
} from '@/lib/api/queries/api-clients';
import type {
  ApiClient,
  ClientScope,
  ClientCredentials,
} from '@/lib/api/resources/api-clients';
import { LoadError, LoadingMessage } from '@/components/common/query-status';
import { useAuth } from '@/lib/auth/context';
import { hasScope } from '@/lib/auth/scopes';
import { slugify } from '@/lib/tenant/slug';

import { ApiClientSecret } from './api-client-secret';
import {
  ApiClientSecretRotation,
  ApiClientSecretRotationDrawer,
} from './api-client-secret-rotation';

type ClientFormError =
  | 'apiClients.drawer.validation.requiredFields'
  | 'apiClients.drawer.validation.redirectUris';

export function ApiClientDrawer({
  tenantId,
  client,
  onClose,
  onSaved,
  onCredentialsCreated,
  embedded = false,
  cancelLabel,
  fixedGrantTypes,
}: {
  tenantId: string;
  client?: ApiClient;
  onClose: () => void;
  onSaved?: () => void;
  onCredentialsCreated?: (credentials: ClientCredentials) => void;
  embedded?: boolean;
  cancelLabel?: string;
  fixedGrantTypes?: readonly string[];
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const scopes = useClientScopes();
  const mutation = useSaveApiClient(tenantId, client);
  const [name, setName] = useState(client?.name ?? '');
  const [clientId, setClientId] = useState('');
  const [clientIdCustomized, setClientIdCustomized] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(
    client?.scopes ?? [],
  );
  const [grants, setGrants] = useState(
    client?.grant_types ?? ['client_credentials'],
  );
  const [uris, setUris] = useState(
    (client?.redirect_uris ?? []).map((value) => ({
      id: crypto.randomUUID(),
      value,
    })),
  );
  const [error, setError] = useState<ClientFormError | null>(null);
  const [rotating, setRotating] = useState(false);
  const [credentials, setCredentials] = useState<ClientCredentials | null>(
    null,
  );
  const availableScopes = (scopes.data ?? []).filter(
    (scope) => scope.name && hasScope(user, scope.name),
  );
  const lockedScopes = selectedScopes.filter(
    (scope) => !availableScopes.some(({ name }) => name === scope),
  );
  const suggestedClientId = `dtcs_${(slugify(name) || 'client').slice(0, 250)}`;
  const currentClientId = (
    clientIdCustomized ? clientId : suggestedClientId
  ).trim();
  const hasClientIdError =
    clientIdCustomized &&
    currentClientId.length > 0 &&
    !/^dtcs_[a-z0-9][a-z0-9_-]{0,249}$/.test(currentClientId);
  const grantOptions = [
    {
      value: 'client_credentials',
      label: t('apiClients.grantTypes.clientCredentials'),
    },
    {
      value: 'authorization_code',
      label: t('apiClients.grantTypes.authorizationCode'),
    },
    {
      value: 'refresh_token',
      label: t('apiClients.grantTypes.refreshToken'),
    },
  ] as const;
  const submittedGrantTypes = fixedGrantTypes ? [...fixedGrantTypes] : grants;
  const visibleGrantOptions = fixedGrantTypes
    ? grantOptions.filter(({ value }) => fixedGrantTypes.includes(value))
    : grantOptions;
  const close = () => {
    if (mutation.isPending) return;
    setCredentials(null);
    mutation.reset();
    onClose();
  };
  const acknowledgeCredentials = () => {
    close();
  };

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    const redirectUris = uris.map(({ value }) => value.trim());
    if (!name.trim() || !selectedScopes.length || !submittedGrantTypes.length) {
      setError('apiClients.drawer.validation.requiredFields');
      return;
    }
    if (
      redirectUris.some((uri) => {
        try {
          const url = new URL(uri);
          return (
            !['https:', 'http:'].includes(url.protocol) || Boolean(url.hash)
          );
        } catch {
          return true;
        }
      }) ||
      (submittedGrantTypes.includes('authorization_code') &&
        !redirectUris.length)
    ) {
      setError('apiClients.drawer.validation.redirectUris');
      return;
    }
    setError(null);
    mutation.mutate(
      {
        name: name.trim(),
        ...(!client && {
          client_id: (clientIdCustomized ? clientId : suggestedClientId).trim(),
        }),
        scopes: selectedScopes as ClientScope[],
        redirect_uris: redirectUris,
        grant_types: submittedGrantTypes,
      },
      {
        onSuccess: (result) => {
          onSaved?.();
          if (result && embedded && onCredentialsCreated) {
            onCredentialsCreated(result);
          } else if (result) {
            setCredentials(result);
          } else {
            mutation.reset();
            onClose();
          }
        },
      },
    );
  }

  const Body = embedded ? 'div' : DrawerBody;
  const Footer = embedded ? 'div' : DrawerFooter;
  const Description = embedded ? 'p' : DrawerDescription;
  const title = credentials
    ? t('apiClients.drawer.credentialsTitle')
    : client
      ? t('apiClients.drawer.editTitle')
      : t('apiClients.drawer.createTitle');
  const form = (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <Body
        className={
          embedded
            ? 'relative flex flex-col gap-(--layout-margin-medium)'
            : undefined
        }
        aria-busy={mutation.isPending}
      >
        <Description
          className={
            embedded
              ? 'text-small-body leading-6 text-(--typography-color-secondary)'
              : undefined
          }
        >
          {client
            ? t('apiClients.drawer.editDescription')
            : t('apiClients.drawer.createDescription')}
        </Description>
        <fieldset disabled={mutation.isPending} className="flex flex-col gap-5">
          <TextField
            label={t('apiClients.fields.clientName')}
            isRequired
            maxLength={255}
            value={name}
            onChange={setName}
          />
          {client ? (
            <>
              <div className="flex flex-col [&_input]:font-mono!">
                <TextField
                  label={t('apiClients.fields.clientId')}
                  isReadOnly
                  value={client.client_id ?? ''}
                  description={t('apiClients.drawer.clientIdLocked')}
                />
              </div>
              <ApiClientSecretRotation
                client={client}
                onRotate={() => setRotating(true)}
              />
            </>
          ) : (
            <div className="flex flex-col [&_input]:font-mono!">
              <TextField
                label={t('apiClients.fields.clientId')}
                isRequired
                maxLength={255}
                pattern="dtcs_[a-z0-9][a-z0-9_-]{0,249}"
                isInvalid={hasClientIdError}
                description={t('apiClients.drawer.clientIdHint')}
                errorMessage={t('apiClients.drawer.clientIdInvalid')}
                value={clientIdCustomized ? clientId : suggestedClientId}
                onChange={(value) => {
                  setClientIdCustomized(true);
                  setClientId(value);
                }}
              />
            </div>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-body font-bold text-(--typography-color-primary)">
              {t('apiClients.fields.scopes')}
            </legend>
            <p className="text-body text-(--typography-color-primary)">
              {t('apiClients.drawer.scopesHelp')}
            </p>
            {scopes.isLoading && (
              <LoadingMessage>
                {t('apiClients.drawer.loadingScopes')}
              </LoadingMessage>
            )}
            {scopes.isError && (
              <LoadError
                message={t('apiClients.drawer.loadScopesFailed')}
                onRetry={() => void scopes.refetch()}
                retryLabel={t('apiClients.drawer.retryScopes')}
              />
            )}
            {scopes.isSuccess && (
              <div className="flex flex-col [&>.bcds-react-aria-Button]:justify-between!">
                <MenuTrigger>
                  <Button
                    variant="secondary"
                    aria-label={t('apiClients.drawer.selectScopes')}
                    isDisabled={mutation.isPending}
                  >
                    {t('apiClients.drawer.selectScopesPlaceholder')}
                    <SvgChevronDownIcon />
                  </Button>
                  <Menu
                    placement="bottom start"
                    className="bcds-react-aria-Menu medium max-h-72 overflow-y-auto"
                    selectionMode="multiple"
                    selectedKeys={selectedScopes}
                    disabledKeys={lockedScopes}
                    onSelectionChange={(keys) => {
                      if (keys === 'all') return;
                      const next = [...keys].map(String);
                      setSelectedScopes([
                        ...selectedScopes.filter((scope) =>
                          next.includes(scope),
                        ),
                        ...next.filter(
                          (scope) => !selectedScopes.includes(scope),
                        ),
                      ]);
                    }}
                  >
                    <MenuSection>
                      <MenuSectionHeader>
                        {t('apiClients.drawer.availableScopes')}
                      </MenuSectionHeader>
                      {availableScopes.map((scope) => (
                        <MenuItem
                          key={scope.name}
                          id={scope.name}
                          textValue={scope.name}
                          label={scope.name}
                          description={scope.description}
                        />
                      ))}
                    </MenuSection>
                    {lockedScopes.map((scope) => (
                      <MenuItem
                        key={scope}
                        id={scope}
                        label={t('apiClients.drawer.scopeNotChangeable', {
                          scope,
                        })}
                      />
                    ))}
                  </Menu>
                </MenuTrigger>
              </div>
            )}
            {selectedScopes.length > 0 && (
              <TagGroup
                aria-label={t('apiClients.fields.scopes')}
                disabledKeys={
                  mutation.isPending ? selectedScopes : lockedScopes
                }
                onRemove={(keys) =>
                  setSelectedScopes(
                    selectedScopes.filter((scope) => !keys.has(scope)),
                  )
                }
              >
                <TagList
                  items={selectedScopes.map((scope) => ({
                    id: scope,
                    textValue: scope,
                    color: 'blue',
                  }))}
                />
              </TagGroup>
            )}
          </fieldset>
          <CheckboxGroup
            label={t('apiClients.fields.grantTypes')}
            value={submittedGrantTypes}
            onChange={(value) => {
              if (!fixedGrantTypes) setGrants(value);
            }}
          >
            {visibleGrantOptions.map(({ value, label }) => (
              <Checkbox
                key={value}
                value={value}
                isDisabled={Boolean(fixedGrantTypes)}
              >
                {label}
              </Checkbox>
            ))}
          </CheckboxGroup>
          <div className="flex flex-col gap-2">
            <h3 className="text-body font-bold text-(--typography-color-primary)">
              {t('apiClients.fields.redirectUris')}
            </h3>
            <p className="text-body text-(--typography-color-primary)">
              {t('apiClients.drawer.redirectUriHelp')}
            </p>
            {uris.map((uri, index) => (
              <div key={uri.id} className="flex items-center gap-2">
                <TextField
                  type="url"
                  isRequired
                  aria-label={t('apiClients.drawer.redirectUriFor', {
                    index: index + 1,
                  })}
                  // BCDS forwards placeholder to the input but omits it from TextFieldProps.
                  {...{
                    placeholder: t('apiClients.drawer.redirectUriPlaceholder'),
                  }}
                  value={uri.value}
                  onChange={(value) =>
                    setUris(
                      uris.map((item) =>
                        item.id === uri.id ? { ...item, value } : item,
                      ),
                    )
                  }
                />
                <Button
                  variant="tertiary"
                  isIconButton
                  aria-label={t('apiClients.drawer.removeRedirectUriFor', {
                    index: index + 1,
                  })}
                  onPress={() =>
                    setUris(uris.filter((item) => item.id !== uri.id))
                  }
                >
                  <TrashIcon className="size-5" />
                </Button>
              </div>
            ))}
            <div>
              <Button
                variant="secondary"
                size="small"
                onPress={() =>
                  setUris([...uris, { id: crypto.randomUUID(), value: '' }])
                }
              >
                <PlusIcon className="size-5" />
                {t('apiClients.drawer.addUri')}
              </Button>
            </div>
          </div>
        </fieldset>
        {(error || mutation.error) && (
          <InlineAlert
            variant="danger"
            role="alert"
            description={error ? t(error) : (mutation.error?.message ?? '')}
          />
        )}
      </Body>
      <Footer
        className={
          embedded
            ? 'mt-auto flex flex-wrap items-center justify-end gap-(--layout-margin-small) border-t border-(--surface-color-border-default) pt-(--layout-padding-medium)'
            : undefined
        }
      >
        <Button
          variant="secondary"
          isDisabled={mutation.isPending}
          onPress={close}
        >
          {cancelLabel ?? t('common.cancel')}
        </Button>
        <Button
          type="submit"
          isDisabled={mutation.isPending || !scopes.isSuccess}
        >
          {mutation.isPending && (
            <span aria-hidden="true" className="contents">
              <ProgressCircle
                isIndeterminate
                size="small"
                aria-label={t('apiClients.drawer.saving')}
              />
            </span>
          )}
          {mutation.isPending
            ? t('apiClients.drawer.saving')
            : client
              ? t('apiClients.drawer.saveChanges')
              : t('apiClients.drawer.createClient')}
        </Button>
      </Footer>
    </form>
  );
  const secretView = credentials && (
    <ApiClientSecret
      credentials={credentials}
      onDone={acknowledgeCredentials}
      embedded={embedded}
    />
  );

  return (
    <>
      {embedded ? (
        <div className="flex w-full flex-col gap-(--layout-margin-medium)">
          {credentials && (
            <h3 className="text-h4 font-bold text-black">{title}</h3>
          )}
          {secretView ?? form}
        </div>
      ) : (
        <Drawer
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
          dismissible={!mutation.isPending}
        >
          <DrawerContent showCloseButton={!mutation.isPending}>
            <DrawerHeader>
              <DrawerTitle>{title}</DrawerTitle>
            </DrawerHeader>
            {secretView ?? form}
          </DrawerContent>
        </Drawer>
      )}
      {client && (
        <ApiClientSecretRotationDrawer
          tenantId={tenantId}
          client={client}
          open={rotating}
          onClose={() => setRotating(false)}
        />
      )}
    </>
  );
}
