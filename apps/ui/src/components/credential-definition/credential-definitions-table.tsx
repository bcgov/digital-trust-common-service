import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/common/button';
import {
  StatusBadge,
  type StatusBadgeTone,
} from '@/components/common/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/common/table';
import type { Connector } from '@/lib/api/resources/connectors';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';

const STATUS_KEYS = {
  draft: 'credentialDefinitions.statuses.draft',
  published: 'credentialDefinitions.statuses.published',
  deprecated: 'credentialDefinitions.statuses.deprecated',
  pending: 'credentialDefinitions.statuses.pending',
  failed: 'credentialDefinitions.statuses.failed',
  unverified: 'credentialDefinitions.statuses.unverified',
} as const;

const FORMAT_KEYS = {
  anoncreds: 'credentialDefinitions.setup.anoncreds',
  'sd-jwt': 'credentialDefinitions.formats.sdJwt',
  mdl: 'credentialDefinitions.formats.mdl',
  'w3c-vc': 'credentialDefinitions.formats.w3cVc',
} as const;

function displayStatus(
  definition: CredentialDefinition,
): keyof typeof STATUS_KEYS {
  if (
    definition.status === 'published' &&
    definition.registration_state !== 'ready'
  ) {
    return definition.registration_state ?? 'unverified';
  }
  return definition.status ?? 'draft';
}

function statusTone(status: keyof typeof STATUS_KEYS): StatusBadgeTone {
  if (status === 'published') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'draft' || status === 'pending' || status === 'unverified') {
    return 'pending';
  }
  return 'neutral';
}

export function CredentialDefinitionsTable({
  definitions,
  connectors,
  onDelete,
  onEditDraft,
}: {
  definitions: readonly CredentialDefinition[];
  connectors: readonly Connector[];
  onDelete: (definition: CredentialDefinition) => void;
  onEditDraft: (definition: CredentialDefinition) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="min-w-0 border-y border-border">
      <Table
        aria-label={t('credentialDefinitions.table.label')}
        className="min-w-[56rem] table-fixed"
      >
        <TableHeader className="bg-muted/50 [&_th]:h-12 [&_th]:px-5 [&_th]:font-bold">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col">
              {t('credentialDefinitions.table.name')}
            </TableHead>
            <TableHead scope="col" className="w-28">
              {t('credentialDefinitions.table.version')}
            </TableHead>
            <TableHead scope="col" className="w-32">
              {t('credentialDefinitions.table.format')}
            </TableHead>
            <TableHead scope="col" className="w-32">
              {t('credentialDefinitions.table.status')}
            </TableHead>
            <TableHead scope="col" className="w-64">
              {t('credentialDefinitions.table.connector')}
            </TableHead>
            <TableHead scope="col" className="w-24 text-right">
              <span className="sr-only">
                {t('credentialDefinitions.table.actions')}
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:px-5 [&_td]:py-5">
          {definitions.map((definition) => {
            const editableDraft =
              definition.status === 'draft' && Boolean(definition.id);
            const description =
              typeof definition.metadata?.description === 'string'
                ? definition.metadata.description.trim()
                : '';
            const connectorUrl = definition.connector_id
              ? connectors.find(
                  (connector) => connector.id === definition.connector_id,
                )?.endpoint_url
              : undefined;
            const currentStatus = displayStatus(definition);

            return (
              <TableRow
                key={definition.id}
                tabIndex={editableDraft ? 0 : undefined}
                aria-label={
                  editableDraft
                    ? t('credentialDefinitions.table.editDraftRow', {
                        name: definition.name,
                      })
                    : undefined
                }
                onClick={
                  editableDraft ? () => onEditDraft(definition) : undefined
                }
                onKeyDown={
                  editableDraft
                    ? (event) => {
                        if (
                          event.target !== event.currentTarget ||
                          (event.key !== 'Enter' && event.key !== ' ')
                        ) {
                          return;
                        }
                        event.preventDefault();
                        onEditDraft(definition);
                      }
                    : undefined
                }
                className={`border-border ${editableDraft ? 'cursor-pointer hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring' : ''}`}
              >
                <TableCell className="break-words whitespace-normal font-medium">
                  <div>{definition.name}</div>
                  {description && (
                    <p className="mt-1 text-xs font-normal text-muted-foreground">
                      {description}
                    </p>
                  )}
                </TableCell>
                <TableCell>{definition.version ?? '1.0'}</TableCell>
                <TableCell>
                  {definition.format
                    ? t(FORMAT_KEYS[definition.format])
                    : t('credentialDefinitions.formats.unknown')}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    tone={statusTone(currentStatus)}
                    label={t(STATUS_KEYS[currentStatus])}
                  />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="capitalize">
                    {definition.connector_type ??
                      t('credentialDefinitions.table.unknown')}
                  </div>
                  {connectorUrl && (
                    <p
                      className="mt-1 truncate text-xs text-muted-foreground"
                      title={connectorUrl}
                    >
                      {connectorUrl}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('credentialDefinitions.delete.rowAction', {
                      name: definition.name,
                    })}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(definition);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
