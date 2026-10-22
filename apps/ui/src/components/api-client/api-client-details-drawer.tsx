import { Badge } from '@/components/common/badge';
import { Button } from '@/components/common/button';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/common/drawer';
import { ScopeBadge } from '@/components/common/scope-badge';
import type { ApiClient } from '@/lib/api/resources/api-clients';

export function ApiClientDetailsDrawer({
  client,
  onClose,
}: {
  client: ApiClient;
  onClose: () => void;
}) {
  return (
    <Drawer
      direction="right"
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle>API client details</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          <dl className="divide-y divide-border border-y border-border text-sm [&>div]:grid [&>div]:gap-x-6 [&>div]:gap-y-1.5 [&>div]:py-4 [&>div]:sm:grid-cols-[7rem_minmax(0,1fr)] [&_dd]:min-w-0 [&_dd]:text-muted-foreground [&_dt]:font-bold [&_dt]:text-foreground">
            <div>
              <dt>Name</dt>
              <dd>{client.name}</dd>
            </div>
            <div>
              <dt>Client ID</dt>
              <dd className="break-all font-mono">{client.client_id}</dd>
            </div>
            <div>
              <dt>How it authenticates</dt>
              <dd className="space-y-1.5">
                <Badge variant="outline">
                  {client.is_public ? 'Public client' : 'Confidential client'}
                </Badge>
                <p>
                  {client.is_public
                    ? 'For browser or mobile apps. Uses PKCE without a client secret.'
                    : 'For server-side apps. Uses a client secret as well as PKCE.'}
                </p>
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{client.revoked_at ? 'Disabled' : 'Enabled'}</dd>
            </div>
            <div>
              <dt>Scopes</dt>
              <dd>
                {client.scopes?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {client.scopes.map((scope) => (
                      <ScopeBadge key={scope} scope={scope} />
                    ))}
                  </div>
                ) : (
                  'None'
                )}
              </dd>
            </div>
            <div>
              <dt>Grant types</dt>
              <dd className="break-words">
                {client.grant_types?.length
                  ? client.grant_types.join(', ')
                  : 'None'}
              </dd>
            </div>
            <div>
              <dt>Redirect URIs</dt>
              <dd className="break-all">
                {client.redirect_uris?.length
                  ? client.redirect_uris.join(', ')
                  : 'None'}
              </dd>
            </div>
          </dl>
        </DrawerBody>
        <DrawerFooter className="shrink-0">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
