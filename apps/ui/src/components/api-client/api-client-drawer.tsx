import { ChevronDown, LoaderCircle } from 'lucide-react';
import { useId, useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { PlusIcon, TrashIcon } from '@/components/common/icons';
import { Button } from '@/components/common/button';
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { ScopeBadge } from '@/components/common/scope-badge';
import {
  useClientScopes,
  useSaveApiClient,
} from '@/lib/api/queries/api-clients';
import type {
  ApiClient,
  ClientScope,
  ClientCredentials,
} from '@/lib/api/resources/api-clients';
import { useAuth } from '@/lib/auth/context';
import { hasScope } from '@/lib/auth/scopes';
import { slugify } from '@/lib/tenant/slug';

import { ApiClientSecret } from './api-client-secret';
import { ApiClientSecretRotation } from './api-client-secret-rotation';

type ClientFormError =
  | 'apiClients.drawer.validation.requiredFields'
  | 'apiClients.drawer.validation.redirectUris';

export function ApiClientDrawer({
  tenantId,
  client,
  onClose,
  onSaved,
}: {
  tenantId: string;
  client?: ApiClient;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const fieldId = useId();
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
  const [credentials, setCredentials] = useState<ClientCredentials | null>(
    null,
  );
  const availableScopes = (scopes.data ?? []).filter(
    (scope) => scope.name && hasScope(user, scope.name),
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
  const close = () => {
    if (mutation.isPending) return;
    setCredentials(null);
    mutation.reset();
    onClose();
  };

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    const redirectUris = uris.map(({ value }) => value.trim());
    if (!name.trim() || !selectedScopes.length || !grants.length) {
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
      (grants.includes('authorization_code') && !redirectUris.length)
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
        grant_types: grants,
      },
      {
        onSuccess: (result) => {
          onSaved();
          if (result) setCredentials(result);
          else {
            mutation.reset();
            onClose();
          }
        },
      },
    );
  }

  return (
    <Drawer
      direction="right"
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      dismissible={!mutation.isPending}
    >
      <DrawerContent showCloseButton={!mutation.isPending}>
        <DrawerHeader>
          <DrawerTitle>
            {credentials
              ? t('apiClients.drawer.credentialsTitle')
              : client
                ? t('apiClients.drawer.editTitle')
                : t('apiClients.drawer.createTitle')}
          </DrawerTitle>
        </DrawerHeader>
        {credentials ? (
          <ApiClientSecret credentials={credentials} onDone={close} />
        ) : (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
            <DrawerBody>
              <DrawerDescription>
                {client
                  ? t('apiClients.drawer.editDescription')
                  : t('apiClients.drawer.createDescription')}
              </DrawerDescription>
              <fieldset
                disabled={mutation.isPending}
                className="flex flex-col gap-5"
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${fieldId}-name`}>
                    {t('apiClients.fields.clientName')}
                  </Label>
                  <Input
                    id={`${fieldId}-name`}
                    required
                    maxLength={255}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                {client ? (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`${fieldId}-id`}>
                        {t('apiClients.fields.clientId')}
                      </Label>
                      <Input
                        id={`${fieldId}-id`}
                        readOnly
                        value={client.client_id ?? ''}
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('apiClients.drawer.clientIdLocked')}
                      </p>
                    </div>
                    <ApiClientSecretRotation
                      tenantId={tenantId}
                      client={client}
                    />
                  </>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`${fieldId}-id`}>
                      {t('apiClients.fields.clientId')}
                    </Label>
                    <Input
                      id={`${fieldId}-id`}
                      required
                      maxLength={255}
                      pattern="dtcs_[a-z0-9][a-z0-9_-]{0,249}"
                      title={t('apiClients.drawer.clientIdPattern')}
                      aria-invalid={hasClientIdError}
                      aria-describedby={`${fieldId}-id-hint${hasClientIdError ? ` ${fieldId}-id-error` : ''}`}
                      value={clientIdCustomized ? clientId : suggestedClientId}
                      onChange={(event) => {
                        setClientIdCustomized(true);
                        setClientId(event.target.value);
                      }}
                      className="font-mono text-xs"
                    />
                    <p
                      id={`${fieldId}-id-hint`}
                      className="text-xs text-muted-foreground"
                    >
                      {t('apiClients.drawer.clientIdHint')}
                    </p>
                    {hasClientIdError && (
                      <p
                        id={`${fieldId}-id-error`}
                        className="text-xs text-destructive"
                      >
                        {t('apiClients.drawer.clientIdInvalid')}
                      </p>
                    )}
                  </div>
                )}
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-semibold">
                    {t('apiClients.fields.scopes')}
                  </legend>
                    {scopes.isLoading && (
                      <p role="status">{t('apiClients.drawer.loadingScopes')}</p>
                    )}
                  {scopes.isError && (
                    <div role="alert">
                        {t('apiClients.drawer.loadScopesFailed')}{' '}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void scopes.refetch()}
                      >
                          {t('apiClients.drawer.retryScopes')}
                      </Button>
                    </div>
                  )}
                  {scopes.isSuccess && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                            aria-label={t('apiClients.drawer.selectScopes')}
                          disabled={mutation.isPending}
                          className="w-full justify-between font-normal"
                        >
                            {t('apiClients.drawer.selectScopesPlaceholder')}
                          <ChevronDown aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="max-h-72 overflow-y-auto"
                      >
                          <DropdownMenuLabel>
                            {t('apiClients.drawer.availableScopes')}
                          </DropdownMenuLabel>
                        {availableScopes.map((scope) => (
                          <DropdownMenuCheckboxItem
                            key={scope.name}
                            checked={selectedScopes.includes(scope.name!)}
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(checked) =>
                              setSelectedScopes(
                                checked
                                  ? [...selectedScopes, scope.name!]
                                  : selectedScopes.filter(
                                      (value) => value !== scope.name,
                                    ),
                              )
                            }
                          >
                            <span className="flex min-w-0 flex-col">
                              <span className="font-medium">{scope.name}</span>
                              {scope.description && (
                                <span className="text-xs text-muted-foreground">
                                  {scope.description}
                                </span>
                              )}
                            </span>
                          </DropdownMenuCheckboxItem>
                        ))}
                        {selectedScopes
                          .filter(
                            (scope) =>
                              !availableScopes.some(
                                ({ name: scopeName }) => scopeName === scope,
                              ),
                          )
                          .map((scope) => (
                            <DropdownMenuCheckboxItem
                              key={scope}
                              checked
                              disabled
                            >
                                {t('apiClients.drawer.scopeNotChangeable', {
                                  scope,
                                })}
                            </DropdownMenuCheckboxItem>
                          ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {selectedScopes.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedScopes.map((scope) => {
                        const canRemove = availableScopes.some(
                          ({ name }) => name === scope,
                        );

                        return (
                          <ScopeBadge
                            key={scope}
                            scope={scope}
                            title={
                              canRemove
                                ? undefined
                                : t('apiClients.drawer.scopeNotRemovable')
                            }
                            onRemove={
                              canRemove
                                ? () =>
                                    setSelectedScopes(
                                      selectedScopes.filter(
                                        (value) => value !== scope,
                                      ),
                                    )
                                : undefined
                            }
                            removeDisabled={mutation.isPending}
                          />
                        );
                      })}
                    </div>
                  )}
                </fieldset>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-semibold">
                    {t('apiClients.fields.grantTypes')}
                  </legend>
                  {grantOptions.map(({ value, label }) => (
                    <label
                      key={value}
                      className="flex items-center gap-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={grants.includes(value)}
                        onChange={(event) =>
                          setGrants(
                            event.target.checked
                              ? [...grants, value]
                              : grants.filter((grant) => grant !== value),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">
                    {t('apiClients.fields.redirectUris')}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t('apiClients.drawer.redirectUriHelp')}
                  </p>
                  {uris.map((uri, index) => (
                    <div key={uri.id} className="flex items-center gap-2">
                      <Input
                        type="url"
                        required
                        aria-label={t('apiClients.drawer.redirectUriFor', {
                          index: index + 1,
                        })}
                        placeholder="https://"
                        value={uri.value}
                        onChange={(event) =>
                          setUris(
                            uris.map((item) =>
                              item.id === uri.id
                                ? { ...item, value: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title={t('apiClients.drawer.removeRedirectUriFor', {
                          index: index + 1,
                        })}
                        aria-label={t(
                          'apiClients.drawer.removeRedirectUriFor',
                          { index: index + 1 },
                        )}
                        onClick={() =>
                          setUris(uris.filter((item) => item.id !== uri.id))
                        }
                      >
                        <TrashIcon aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="self-start"
                    onClick={() =>
                      setUris([...uris, { id: crypto.randomUUID(), value: '' }])
                    }
                  >
                    <PlusIcon aria-hidden="true" />
                    {t('apiClients.drawer.addUri')}
                  </Button>
                </div>
              </fieldset>
              {(error || mutation.error) && (
                <p role="alert" className="text-sm text-destructive">
                  {error ? t(error) : mutation.error?.message}
                </p>
              )}
            </DrawerBody>
            <DrawerFooter>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={close}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || !scopes.isSuccess}
              >
                {mutation.isPending && (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                )}
                {mutation.isPending
                  ? t('apiClients.drawer.saving')
                  : client
                    ? t('apiClients.drawer.saveChanges')
                    : t('apiClients.drawer.createClient')}
              </Button>
            </DrawerFooter>
          </form>
        )}
      </DrawerContent>
    </Drawer>
  );
}
