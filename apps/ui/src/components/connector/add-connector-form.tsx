import {
  Button,
  InlineAlert,
  ProgressCircle,
  Select,
  TextField,
} from '@bcgov/design-system-react-components';
import { type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DrawerBody,
  DrawerDescription,
  DrawerFooter,
} from '@/components/common/drawer';
import { CircleInfoIcon } from '@/components/common/icons';
import { ApiError } from '@/lib/api/errors';
import type { useCreateConnector } from '@/lib/api/queries/connectors';

interface AddConnectorFormProps {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  errors: Record<string, string[] | undefined>;
  mutation: ReturnType<typeof useCreateConnector>;
  canCreate: boolean;
}

export function AddConnectorForm({
  onSubmit,
  onCancel,
  errors,
  mutation,
  canCreate,
}: AddConnectorFormProps) {
  const { t } = useTranslation();

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DrawerBody
        className="relative min-h-0 gap-0 px-0 py-6"
        aria-busy={mutation.isPending}
      >
        <DrawerDescription className="px-6 text-small-body leading-6 text-(--typography-color-secondary)">
          {t('connectors.form.description')}
        </DrawerDescription>
        {mutation.isError && (
          <div className="mt-4 px-6">
            <InlineAlert
              variant="danger"
              role="alert"
              title={t('connectors.form.createFailedTitle')}
              description={
                mutation.error instanceof ApiError
                  ? mutation.error.message
                  : t('connectors.form.createFailed')
              }
            />
          </div>
        )}
        <fieldset
          disabled={mutation.isPending}
          className="mt-4 flex flex-col gap-4 px-6"
        >
          <Select
            label={t('connectors.form.type')}
            name="connector_type"
            isRequired
            isDisabled={mutation.isPending}
            defaultSelectedKey="traction"
            items={[{ id: 'traction', label: t('connectors.form.traction') }]}
          />
          <TextField
            label={t('connectors.form.endpointUrl')}
            name="endpoint_url"
            type="url"
            // BCDS forwards placeholder to the input but omits it from TextFieldProps.
            {...{ placeholder: t('connectors.form.endpointUrlPlaceholder') }}
            isRequired
            validationBehavior="aria"
            isInvalid={Boolean(errors.endpoint_url)}
            errorMessage={errors.endpoint_url?.[0]}
          />
          <TextField
            label={t('connectors.form.apiKey')}
            name="credentials.api_key"
            type="password"
            autoComplete="off"
            // BCDS forwards placeholder to the input but omits it from TextFieldProps.
            {...{ placeholder: t('connectors.form.apiKeyPlaceholder') }}
            isRequired
            validationBehavior="aria"
            isInvalid={Boolean(errors.api_key)}
            errorMessage={errors.api_key?.[0]}
          />
          <TextField
            label={t('connectors.form.tractionTenantId')}
            name="credentials.traction_tenant_id"
          />
          <TextField
            label={t('connectors.form.webhookSecret')}
            name="credentials.webhook_secret"
            type="password"
            autoComplete="off"
          />
        </fieldset>
        {mutation.isPending && (
          <div
            role="status"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-(--surface-color-background-white)/90"
          >
            <ProgressCircle
              isIndeterminate
              aria-label={t('connectors.form.testing')}
            />
            <span className="text-small-body font-medium">
              {t('connectors.form.testing')}
            </span>
          </div>
        )}
      </DrawerBody>
      <DrawerFooter className="shrink-0 items-center gap-4">
        <p className="flex min-w-40 flex-1 items-start gap-2 text-label leading-5 text-(--typography-color-secondary)">
          <CircleInfoIcon className="mt-0.5 size-4 shrink-0" />
          <span>{t('connectors.form.testNotice')}</span>
        </p>
        <div className="ml-auto flex gap-3">
          <Button
            variant="secondary"
            isDisabled={mutation.isPending}
            onPress={onCancel}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" isDisabled={!canCreate || mutation.isPending}>
            {mutation.isPending
              ? t('connectors.form.creating')
              : mutation.isError
                ? t('connectors.form.tryAgain')
                : t('connectors.form.create')}
          </Button>
        </div>
      </DrawerFooter>
    </form>
  );
}
