import { EllipsisVertical, Info, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/common/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Separator } from '@/components/common/separator';
import { ScopeBadge } from '@/components/common/scope-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/common/table';
import type { ApiClient } from '@/lib/api/resources/api-clients';

export function ApiClientsTable({
  clients,
  onViewDetails,
  onEdit,
  onRevoke,
  onAction,
}: {
  clients: ApiClient[];
  onViewDetails: (client: ApiClient) => void;
  onEdit: (client: ApiClient) => void;
  onRevoke: (client: ApiClient) => void;
  onAction: (client: ApiClient, action: 'disable' | 'reactivate') => void;
}) {
  return (
    <div className="min-w-0 border-y border-border">
      <Table aria-label="API clients" className="min-w-[48rem] table-fixed">
        <TableHeader className="bg-muted/50 [&_th]:px-5 [&_th]:font-bold">
          <TableRow>
            <TableHead className="w-1/3">Client</TableHead>
            <TableHead>Scopes</TableHead>
            <TableHead className="w-44">Status</TableHead>
            <TableHead className="w-36 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:px-5 [&_td]:py-4">
          {clients.map((client) => (
            <TableRow key={client.client_id}>
              <TableCell className="whitespace-normal">
                <div className="font-semibold">{client.name}</div>
                <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {client.client_id}
                </div>
                {client.is_public && (
                  <span className="text-xs text-muted-foreground">
                    Public (PKCE)
                  </span>
                )}
              </TableCell>
              <TableCell className="whitespace-normal">
                <div className="flex flex-wrap gap-1">
                  {client.scopes?.map((scope) => (
                    <ScopeBadge key={scope} scope={scope} />
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!client.revoked_at}
                    aria-label={`Active status for ${client.name}`}
                    onClick={() =>
                      onAction(
                        client,
                        client.revoked_at ? 'reactivate' : 'disable',
                      )
                    }
                    className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors ${client.revoked_at ? 'bg-muted-foreground' : 'bg-primary'}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none block size-5 rounded-full bg-background shadow-sm transition-transform ${client.revoked_at ? 'translate-x-0' : 'translate-x-5'}`}
                    />
                  </button>
                  <span className="text-sm">
                    {client.revoked_at ? 'Disabled' : 'Enabled'}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Actions for ${client.name}`}
                    >
                      <EllipsisVertical aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onViewDetails(client)}>
                      <Info aria-hidden="true" />
                      View details
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={Boolean(client.revoked_at)}
                      onSelect={() => onEdit(client)}
                    >
                      <Pencil aria-hidden="true" />
                      Edit
                    </DropdownMenuItem>
                    <Separator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={Boolean(client.revoked_at)}
                      onSelect={() => onRevoke(client)}
                    >
                      <Trash2 aria-hidden="true" />
                      Revoke
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
