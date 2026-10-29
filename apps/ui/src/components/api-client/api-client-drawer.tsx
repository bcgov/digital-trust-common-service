import { ChevronDown, LoaderCircle } from 'lucide-react';
import { useId, useState, type SubmitEvent } from 'react';

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
  const [error, setError] = useState('');
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
  const clientIdError =
    clientIdCustomized &&
    currentClientId.length > 0 &&
    !/^dtcs_[a-z0-9][a-z0-9_-]{0,249}$/.test(currentClientId)
      ? 'Client ID must start with dtcs_ and contain only lowercase letters, numbers, hyphens, or underscores.'
      : '';
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
      setError('Enter a name and select at least one scope and grant type.');
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
      setError(
        'Enter a valid HTTP or HTTPS redirect URI without a fragment. Authorization Code requires at least one URI.',
      );
      return;
    }
    setError('');
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
              ? 'Client credentials'
              : client
                ? 'Edit API client'
                : 'Create API client'}
          </DrawerTitle>
        </DrawerHeader>
        {credentials ? (
          <ApiClientSecret credentials={credentials} onDone={close} />
        ) : (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
            <DrawerBody>
              <DrawerDescription>
                {client
                  ? 'OAuth2 client configuration'
                  : 'Client ID is suggested from the name and can be customized.'}
              </DrawerDescription>
              <fieldset
                disabled={mutation.isPending}
                className="flex flex-col gap-5"
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${fieldId}-name`}>Client name</Label>
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
                      <Label htmlFor={`${fieldId}-id`}>Client ID</Label>
                      <Input
                        id={`${fieldId}-id`}
                        readOnly
                        value={client.client_id ?? ''}
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        Client ID cannot be changed once created
                      </p>
                    </div>
                    <ApiClientSecretRotation
                      tenantId={tenantId}
                      client={client}
                    />
                  </>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`${fieldId}-id`}>Client ID</Label>
                    <Input
                      id={`${fieldId}-id`}
                      required
                      maxLength={255}
                      pattern="dtcs_[a-z0-9][a-z0-9_-]{0,249}"
                      title="Use dtcs_ followed by lowercase letters, numbers, hyphens, or underscores."
                      aria-invalid={Boolean(clientIdError)}
                      aria-describedby={`${fieldId}-id-hint${clientIdError ? ` ${fieldId}-id-error` : ''}`}
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
                      Must be unique across all tenants and cannot be changed
                      later.
                    </p>
                    {clientIdError && (
                      <p
                        id={`${fieldId}-id-error`}
                        className="text-xs text-destructive"
                      >
                        {clientIdError}
                      </p>
                    )}
                  </div>
                )}
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-semibold">Scopes</legend>
                  {scopes.isLoading && <p role="status">Loading scopes...</p>}
                  {scopes.isError && (
                    <div role="alert">
                      Could not load scopes.{' '}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void scopes.refetch()}
                      >
                        Retry scopes
                      </Button>
                    </div>
                  )}
                  {scopes.isSuccess && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          aria-label="Select scopes"
                          disabled={mutation.isPending}
                          className="w-full justify-between font-normal"
                        >
                          Select scopes...
                          <ChevronDown aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="max-h-72 overflow-y-auto"
                      >
                        <DropdownMenuLabel>Available scopes</DropdownMenuLabel>
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
                              {scope} (cannot be changed)
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
                                : 'You do not have permission to change this scope.'
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
                    Grant types
                  </legend>
                  {[
                    'client_credentials',
                    'authorization_code',
                    'refresh_token',
                  ].map((grant) => (
                    <label
                      key={grant}
                      className="flex items-center gap-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={grants.includes(grant)}
                        onChange={(event) =>
                          setGrants(
                            event.target.checked
                              ? [...grants, grant]
                              : grants.filter((value) => value !== grant),
                          )
                        }
                      />
                      {grant.replaceAll('_', ' ')}
                    </label>
                  ))}
                </fieldset>
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">Redirect URIs</h3>
                  <p className="text-xs text-muted-foreground">
                    Enter the URL where requests are sent after they authorize
                    access.
                  </p>
                  {uris.map((uri, index) => (
                    <div key={uri.id} className="flex items-center gap-2">
                      <Input
                        type="url"
                        required
                        aria-label={`Redirect URI ${index + 1}`}
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
                        title="Remove redirect URI"
                        aria-label={`Remove redirect URI ${index + 1}`}
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
                    Add URI
                  </Button>
                </div>
              </fieldset>
              {(error || mutation.error) && (
                <p role="alert" className="text-sm text-destructive">
                  {error || mutation.error?.message}
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
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || !scopes.isSuccess}
              >
                {mutation.isPending && (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                )}
                {mutation.isPending
                  ? 'Saving...'
                  : client
                    ? 'Save changes'
                    : 'Create client'}
              </Button>
            </DrawerFooter>
          </form>
        )}
      </DrawerContent>
    </Drawer>
  );
}
