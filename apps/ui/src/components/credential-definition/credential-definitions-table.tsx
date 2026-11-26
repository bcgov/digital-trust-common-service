import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Separator,
} from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CircleInfoIcon,
  EllipsisVerticalIcon,
  TrashIcon,
} from '@/components/common/icons';
import { StaticTag, type StaticTagColor } from '@/components/common/static-tag';
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

import { CredentialDefinitionDetailsDrawer } from './credential-definition-details-drawer';

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

function statusColor(status: keyof typeof STATUS_KEYS): StaticTagColor {
  if (status === 'published') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'pending' || status === 'unverified') return 'yellow';
  return 'grey';
}

export function CredentialDefinitionsTable({
  definitions,
  connectors,
  tenantId,
  onDelete,
  onEditDraft,
}: {
  definitions: readonly CredentialDefinition[];
  connectors: readonly Connector[];
  tenantId: string;
  onDelete: (definition: CredentialDefinition) => void;
  onEditDraft: (definition: CredentialDefinition) => void;
}) {
  const { t } = useTranslation();
  const [definitionId, setDefinitionId] = useState<string | null>(null);

  return (
    <div className="min-w-0">
      <Table
        aria-label={t('credentialDefinitions.table.label')}
        variant="record"
        className="min-w-[67rem] table-fixed"
      >
        <TableHeader>
          <TableRow>
            <TableHead scope="col">
              {t('credentialDefinitions.table.name')}
            </TableHead>
            <TableHead scope="col" className="w-50">
              {t('credentialDefinitions.table.version')}
            </TableHead>
            <TableHead scope="col" className="w-50">
              {t('credentialDefinitions.table.format')}
            </TableHead>
            <TableHead scope="col" className="w-50">
              {t('credentialDefinitions.table.connector')}
            </TableHead>
            <TableHead scope="col" className="w-50">
              {t('credentialDefinitions.table.status')}
            </TableHead>
            <TableHead scope="col" className="w-18 text-right">
              <span className="sr-only">
                {t('credentialDefinitions.table.actions')}
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
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
                className={`border-(--surface-color-border-default) ${editableDraft ? 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--surface-color-border-active)' : ''}`}
              >
                <TableCell className="break-words whitespace-normal">
                  <div className="font-bold text-(--typography-color-primary)">
                    {definition.name}
                  </div>
                  {description && (
                    <p className="mt-1 text-label text-(--typography-color-secondary)">
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
                <TableCell className="whitespace-normal">
                  <div className="capitalize">
                    {definition.connector_type ??
                      t('credentialDefinitions.table.unknown')}
                  </div>
                  {connectorUrl && (
                    <p
                      className="mt-1 truncate text-label text-(--typography-color-secondary)"
                      title={connectorUrl}
                    >
                      {connectorUrl}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <StaticTag
                    color={statusColor(currentStatus)}
                    tagStyle="circular"
                    label={t(STATUS_KEYS[currentStatus])}
                  />
                </TableCell>
                <TableCell
                  className="text-right"
                  onClick={(event) => event.stopPropagation()}
                >
                  <MenuTrigger>
                    <Button
                      variant="tertiary"
                      isIconButton
                      aria-label={t('credentialDefinitions.table.actionsFor', {
                        name: definition.name ?? t('common.notAvailable'),
                        version: definition.version ?? '1.0',
                      })}
                    >
                      <EllipsisVerticalIcon className="size-5" />
                    </Button>
                    <Menu
                      placement="bottom end"
                      className="bcds-react-aria-Menu medium record-menu"
                      onAction={(key) => {
                        if (key === 'view' && definition.id)
                          setDefinitionId(definition.id);
                        else if (key === 'delete') onDelete(definition);
                      }}
                    >
                      <MenuItem
                        id="view"
                        textValue={t('common.viewDetails')}
                        isDisabled={!definition.id}
                      >
                        <CircleInfoIcon className="size-5 shrink-0" />
                        {t('common.viewDetails')}
                      </MenuItem>
                      <Separator size="small" />
                      <MenuItem id="delete" textValue={t('common.delete')}>
                        <TrashIcon className="size-5 shrink-0 text-(--icons-color-danger)" />
                        <span className="text-(--typography-color-danger)">
                          {t('common.delete')}
                        </span>
                      </MenuItem>
                    </Menu>
                  </MenuTrigger>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {definitionId && (
        <CredentialDefinitionDetailsDrawer
          tenantId={tenantId}
          definitionId={definitionId}
          onClose={() => setDefinitionId(null)}
        />
      )}
    </div>
  );
}
