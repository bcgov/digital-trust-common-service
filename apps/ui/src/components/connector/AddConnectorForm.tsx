import { Info, LoaderCircle } from 'lucide-react';
import { useId, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  DrawerBody,
  DrawerClose,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/errors';
import type { useCreateConnector } from '@/lib/api/queries/connectors';

interface AddConnectorFormProps {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  errors: Record<string, string[] | undefined>;
  mutation: ReturnType<typeof useCreateConnector>;
  canCreate: boolean;
}

export function AddConnectorForm({
  onSubmit,
  errors,
  mutation,
  canCreate,
}: AddConnectorFormProps) {
  const fieldId = useId();

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
        <DrawerDescription className="px-6 text-sm leading-6 text-muted-foreground">
          This information will be used to configure your connector. The options
          are what is required to connect to an external digital credential
          agent.
        </DrawerDescription>
        <fieldset
          disabled={mutation.isPending}
          className="mt-4 flex flex-col gap-4 px-6"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-type`}>Connector type</Label>
            <select
              id={`${fieldId}-type`}
              name="connector_type"
              required
              defaultValue="traction"
              className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm"
            >
              <option value="traction">Traction</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-endpoint`}>Endpoint URL</Label>
            <Input
              id={`${fieldId}-endpoint`}
              name="endpoint_url"
              type="url"
              required
              aria-invalid={Boolean(errors.endpoint_url)}
              aria-describedby={
                errors.endpoint_url ? `${fieldId}-endpoint-error` : undefined
              }
            />
            {errors.endpoint_url && (
              <p
                id={`${fieldId}-endpoint-error`}
                role="alert"
                className="text-sm text-destructive"
              >
                {errors.endpoint_url[0]}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-api-key`}>API key</Label>
            <Input
              id={`${fieldId}-api-key`}
              name="credentials.api_key"
              type="password"
              autoComplete="off"
              required
              aria-invalid={Boolean(errors.api_key)}
              aria-describedby={
                errors.api_key ? `${fieldId}-api-key-error` : undefined
              }
            />
            {errors.api_key && (
              <p
                id={`${fieldId}-api-key-error`}
                role="alert"
                className="text-sm text-destructive"
              >
                {errors.api_key[0]}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-tenant`}>
              Traction tenant ID (optional)
            </Label>
            <Input
              id={`${fieldId}-tenant`}
              name="credentials.traction_tenant_id"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-webhook`}>
              Webhook secret (optional)
            </Label>
            <Input
              id={`${fieldId}-webhook`}
              name="credentials.webhook_secret"
              type="password"
              autoComplete="off"
            />
          </div>
        </fieldset>
        {mutation.isError && (
          <p role="alert" className="mt-4 px-6 text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Could not create the connector. Try again.'}
          </p>
        )}
        {mutation.isPending && (
          <div
            role="status"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/90"
          >
            <LoaderCircle
              className="size-10 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span className="text-sm font-medium">Testing connection...</span>
          </div>
        )}
      </DrawerBody>
      <DrawerFooter className="shrink-0 items-center gap-4">
        <p className="flex min-w-40 flex-1 items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>We test the connection before saving</span>
        </p>
        <div className="ml-auto flex gap-3">
          <DrawerClose asChild>
            <Button
              type="button"
              variant="outline"
              className="h-10 bg-white px-6"
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
          </DrawerClose>
          <Button
            type="submit"
            className="h-10 px-6"
            disabled={!canCreate || mutation.isPending}
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </DrawerFooter>
    </form>
  );
}
