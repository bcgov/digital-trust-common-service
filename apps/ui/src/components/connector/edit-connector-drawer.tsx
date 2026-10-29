import { LoaderCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { ConnectorStatus } from '@/components/connector/connector-status';
import { Button } from '@/components/common/button';
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/common/drawer';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { ApiError } from '@/lib/api/errors';
import {
  useTestConnector,
  useUpdateConnector,
} from '@/lib/api/queries/connectors';
import type { Connector } from '@/lib/api/resources/connectors';
import i18n from '@/lib/i18n';

const editConnectorSchema = z.object({
  endpoint_url: z.url({
    protocol: /^https?$/,
    error: () => i18n.t('connectors.form.invalidUrl'),
  }),
  api_key: z.string(),
  traction_tenant_id: z.string(),
  webhook_secret: z.string(),
});

type EditStage = 'saving' | 'testing' | null;

export function EditConnectorDrawer({
  connector,
  tenantId,
  onClose,
}: {
  connector: Connector;
  tenantId: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateConnector(tenantId);
  const test = useTestConnector(tenantId);
  const canRotateWebhookSecret = connector.connector_type === 'traction';
  const [endpointUrl, setEndpointUrl] = useState(connector.endpoint_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [tractionTenantId, setTractionTenantId] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [savedEndpointUrl, setSavedEndpointUrl] = useState(
    connector.endpoint_url ?? '',
  );
  const [hasUnverifiedSave, setHasUnverifiedSave] = useState(false);
  const [stage, setStage] = useState<EditStage>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string[] | undefined>
  >({});
  const [submitError, setSubmitError] = useState<string>();
  const isPending = stage !== null;
  const hasChanges =
    endpointUrl !== savedEndpointUrl ||
    apiKey.length > 0 ||
    tractionTenantId.length > 0 ||
    webhookSecret.length > 0;
  const canSubmit =
    Boolean(tenantId && connector.id) && (hasChanges || hasUnverifiedSave);

  function changeOpen(open: boolean) {
    if (!open && !isPending) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || !connector.id || isPending) return;

    const form = new FormData(event.currentTarget);
    const result = editConnectorSchema.safeParse({
      endpoint_url: form.get('endpoint_url'),
      api_key: form.get('api_key'),
      traction_tenant_id: form.get('traction_tenant_id') ?? '',
      webhook_secret: form.get('webhook_secret') ?? '',
    });
    if (!result.success) {
      setFieldErrors(z.flattenError(result.error).fieldErrors);
      return;
    }

    const values = result.data;
    const endpointChanged = values.endpoint_url !== savedEndpointUrl;
    const apiKeyChanged = values.api_key.length > 0;
    const tractionTenantIdChanged =
      canRotateWebhookSecret && values.traction_tenant_id.length > 0;
    const webhookSecretChanged =
      canRotateWebhookSecret && values.webhook_secret.length > 0;
    if (
      !endpointChanged &&
      !apiKeyChanged &&
      !tractionTenantIdChanged &&
      !webhookSecretChanged &&
      !hasUnverifiedSave
    ) {
      return;
    }

    setFieldErrors({});
    setSubmitError(undefined);
    update.reset();
    test.reset();
    let changesWereSaved = false;

    try {
      if (
        endpointChanged ||
        apiKeyChanged ||
        tractionTenantIdChanged ||
        webhookSecretChanged
      ) {
        setStage('saving');
        await update.mutateAsync({
          connectorId: connector.id,
          body: {
            ...(endpointChanged ? { endpoint_url: values.endpoint_url } : {}),
            ...(apiKeyChanged || tractionTenantIdChanged || webhookSecretChanged
              ? {
                  credentials: {
                    ...(apiKeyChanged ? { api_key: values.api_key } : {}),
                    ...(tractionTenantIdChanged
                      ? { traction_tenant_id: values.traction_tenant_id }
                      : {}),
                    ...(webhookSecretChanged
                      ? { webhook_secret: values.webhook_secret }
                      : {}),
                  },
                }
              : {}),
          },
        });
        changesWereSaved = true;
        setSavedEndpointUrl(values.endpoint_url);
        setEndpointUrl(values.endpoint_url);
        setApiKey('');
        setTractionTenantId('');
        setWebhookSecret('');
        setHasUnverifiedSave(true);
      }

      setStage('testing');
      const result = await test.mutateAsync(connector.id);
      if (result.status !== 'healthy') {
        const message = result.message ?? t('connectors.edit.unhealthy');
        setSubmitError(
          changesWereSaved || hasUnverifiedSave
            ? t('connectors.edit.savedTestFailed', { message })
            : t('connectors.edit.testFailed', { message }),
        );
        setHasUnverifiedSave(true);
        return;
      }

      setHasUnverifiedSave(false);
      onClose();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : t('connectors.edit.tryAgain');
      setSubmitError(
        changesWereSaved || hasUnverifiedSave
          ? t('connectors.edit.savedTestIncomplete', { message })
          : message,
      );
      if (changesWereSaved || hasUnverifiedSave) setHasUnverifiedSave(true);
    } finally {
      setStage(null);
    }
  }

  return (
    <Drawer
      direction="right"
      open
      onOpenChange={changeOpen}
      dismissible={!isPending}
    >
      <DrawerContent showCloseButton={!isPending}>
        <DrawerHeader className="gap-3">
          <DrawerTitle>{t('connectors.edit.title')}</DrawerTitle>
          <div>
            <ConnectorStatus active={connector.active} />
          </div>
        </DrawerHeader>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DrawerBody
            className="relative min-h-0 gap-0 px-0 py-6"
            aria-busy={isPending}
          >
            <DrawerDescription className="px-6 text-sm leading-6 text-muted-foreground">
              {t('connectors.edit.description')}
            </DrawerDescription>
            <fieldset
              disabled={isPending}
              className="mt-6 flex min-w-0 flex-col gap-6 px-6 [&_input]:h-11 [&_input]:rounded-md [&_label]:font-bold"
            >
              <fieldset className="flex min-w-0 flex-col gap-5">
                <legend className="mb-5 w-full border-b border-border pb-3 text-base font-bold">
                  {t('connectors.edit.connection')}
                </legend>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-connector-type">
                    {t('connectors.form.type')}
                  </Label>
                  <Input
                    id="edit-connector-type"
                    value={connector.connector_type ?? ''}
                    readOnly
                    className="border-transparent bg-muted font-medium capitalize text-muted-foreground shadow-none"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-connector-endpoint">
                    {t('connectors.form.endpointUrl')}
                  </Label>
                  <Input
                    id="edit-connector-endpoint"
                    name="endpoint_url"
                    type="url"
                    required
                    className="font-mono"
                    value={endpointUrl}
                    onChange={(event) => setEndpointUrl(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.endpoint_url)}
                    aria-describedby={
                      fieldErrors.endpoint_url
                        ? 'edit-connector-endpoint-error'
                        : undefined
                    }
                  />
                  {fieldErrors.endpoint_url && (
                    <p
                      id="edit-connector-endpoint-error"
                      role="alert"
                      className="text-sm text-destructive"
                    >
                      {fieldErrors.endpoint_url[0]}
                    </p>
                  )}
                </div>
              </fieldset>
              <fieldset className="flex min-w-0 flex-col gap-5">
                <legend className="mb-5 w-full border-b border-border pb-3 text-base font-bold">
                  {t('connectors.edit.credentials')}
                </legend>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-connector-api-key">
                    {t('connectors.edit.newApiKey')}{' '}
                    <span className="font-normal text-muted-foreground">
                      {t('common.optional')}
                    </span>
                  </Label>
                  <Input
                    id="edit-connector-api-key"
                    name="api_key"
                    type="password"
                    autoComplete="new-password"
                    placeholder={t('connectors.edit.keepKey')}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </div>
                {canRotateWebhookSecret && (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="edit-connector-traction-tenant-id">
                        {t('connectors.edit.tractionTenantId')}{' '}
                        <span className="font-normal text-muted-foreground">
                          {t('common.optional')}
                        </span>
                      </Label>
                      <Input
                        id="edit-connector-traction-tenant-id"
                        name="traction_tenant_id"
                        value={tractionTenantId}
                        onChange={(event) =>
                          setTractionTenantId(event.target.value)
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="edit-connector-webhook-secret">
                        {t('connectors.edit.newWebhookSecret')}{' '}
                        <span className="font-normal text-muted-foreground">
                          {t('common.optional')}
                        </span>
                      </Label>
                      <Input
                        id="edit-connector-webhook-secret"
                        name="webhook_secret"
                        type="password"
                        autoComplete="new-password"
                        placeholder={t('connectors.edit.keepSecret')}
                        value={webhookSecret}
                        onChange={(event) =>
                          setWebhookSecret(event.target.value)
                        }
                      />
                    </div>
                  </>
                )}
              </fieldset>
            </fieldset>
            {submitError && (
              <p
                role="alert"
                className="mx-6 mt-6 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive"
              >
                {submitError}
              </p>
            )}
            {isPending && (
              <div
                role="status"
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/90"
              >
                <LoaderCircle
                  className="size-10 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                <span className="text-sm font-medium">
                  {stage === 'saving'
                    ? t('connectors.edit.savingChanges')
                    : t('connectors.form.testing')}
                </span>
              </div>
            )}
          </DrawerBody>
          <DrawerFooter className="shrink-0 gap-3 bg-muted/30">
            <DrawerClose asChild>
              <Button
                type="button"
                variant="outline"
                className="h-11 px-6"
                disabled={isPending}
              >
                {t('common.cancel')}
              </Button>
            </DrawerClose>
            <Button
              type="submit"
              className="h-11 px-6"
              disabled={!canSubmit || isPending}
            >
              {stage === 'saving'
                ? t('connectors.edit.saving')
                : stage === 'testing'
                  ? t('connectors.edit.testing')
                  : hasUnverifiedSave && !hasChanges
                    ? t('connectors.edit.retryTest')
                    : t('connectors.edit.save')}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
