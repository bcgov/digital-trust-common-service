import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CredentialDefinitionDetailsDrawer } from '@/components/credential-definition/credential-definition-details-drawer';
import { StaticTag } from '@/components/common/static-tag';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/common/table';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';
import type { IssuanceProfile } from '@/lib/api/resources/issuance-profiles';

import { IssuanceProfileRowActions } from './issuance-profile-row-actions';

export function IssuanceProfilesTable({
  profiles,
  definitions,
  tenantId,
}: {
  profiles: readonly IssuanceProfile[];
  definitions: readonly CredentialDefinition[];
  tenantId: string;
}) {
  const { t } = useTranslation();
  const [definitionId, setDefinitionId] = useState<string | null>(null);

  return (
    <>
      <Table
        aria-label={t('issuanceProfiles.title')}
        variant="record"
        className="min-w-[48rem] table-fixed"
      >
        <TableHeader>
          <TableRow>
            <TableHead scope="col">
              {t('credentialDefinitions.table.name')}
            </TableHead>
            <TableHead scope="col" className="w-24">
              {t('credentialDefinitions.table.version')}
            </TableHead>
            <TableHead scope="col" className="w-28">
              {t('issuanceProfiles.protocol')}
            </TableHead>
            <TableHead scope="col">
              {t('issuanceProfiles.definition')}
            </TableHead>
            <TableHead scope="col" className="w-28">
              {t('credentialDefinitions.table.format')}
            </TableHead>
            <TableHead scope="col" className="w-28">
              {t('credentialDefinitions.table.status')}
            </TableHead>
            <TableHead scope="col" className="w-20 text-right">
              <span className="sr-only">
                {t('credentialDefinitions.table.actions')}
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {profiles.map((profile) => {
            const definition = definitions.find(
              (item) => item.id === profile.credential_definition_id,
            );
            const profileStatus = profile.status;
            return (
              <TableRow key={profile.id}>
                <TableCell className="font-bold break-words whitespace-normal">
                  {profile.name}
                </TableCell>
                <TableCell className="break-words whitespace-normal">
                  {profile.version}
                </TableCell>
                <TableCell>
                  {profile.delivery?.protocol
                    ? t(
                        `issuanceProfiles.protocols.${profile.delivery.protocol}`,
                      )
                    : t('issuanceProfiles.unavailable')}
                </TableCell>
                <TableCell className="break-words whitespace-normal">
                  {definition?.id ? (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setDefinitionId(definition.id ?? null)}
                    >
                      {definition.name ?? definition.id}
                      {definition.version ? ` (${definition.version})` : ''}
                    </button>
                  ) : (
                    (profile.credential_definition_id ??
                    t('issuanceProfiles.unavailable'))
                  )}
                </TableCell>
                <TableCell>
                  <StaticTag
                    color={
                      profileStatus === 'published'
                        ? 'green'
                        : profileStatus === 'draft'
                          ? 'yellow'
                          : 'grey'
                    }
                    label={
                      profileStatus
                        ? t(`issuanceProfiles.statuses.${profileStatus}`)
                        : t('issuanceProfiles.unavailable')
                    }
                  />
                </TableCell>
                <TableCell className="text-right">
                  <IssuanceProfileRowActions
                    profile={profile}
                    tenantId={tenantId}
                  />
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
    </>
  );
}
