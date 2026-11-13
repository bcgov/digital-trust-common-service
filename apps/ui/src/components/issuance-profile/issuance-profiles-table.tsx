import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

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

const FORMAT_KEYS = {
  anoncreds: 'credentialDefinitions.setup.anoncreds',
  'sd-jwt': 'credentialDefinitions.formats.sdJwt',
  mdl: 'credentialDefinitions.formats.mdl',
  'w3c-vc': 'credentialDefinitions.formats.w3cVc',
} as const;

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

  return (
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
          <TableHead scope="col">{t('issuanceProfiles.definition')}</TableHead>
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
                  ? t(`issuanceProfiles.protocols.${profile.delivery.protocol}`)
                  : t('issuanceProfiles.unavailable')}
              </TableCell>
              <TableCell className="break-words whitespace-normal">
                {definition?.id ? (
                  <Link
                    className="underline"
                    to={`/credential-definitions/${encodeURIComponent(definition.id)}`}
                  >
                    {definition.name ?? definition.id}
                    {definition.version ? ` (${definition.version})` : ''}
                  </Link>
                ) : (
                  (profile.credential_definition_id ??
                  t('issuanceProfiles.unavailable'))
                )}
              </TableCell>
              <TableCell>
                {definition?.format
                  ? t(FORMAT_KEYS[definition.format])
                  : t('issuanceProfiles.unavailable')}
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
  );
}
