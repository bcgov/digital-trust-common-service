import { ApiError } from '@/lib/api/errors';
import i18n from '@/lib/i18n';

/** What to tell the user when a tenant switch is refused. */
export function switchErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'TENANT_NOT_ACTIVE':
        return i18n.t('switcher.errorNotActive');
      case 'TENANT_ACCESS_DENIED':
        return i18n.t('switcher.errorNotMember');
      default:
        return i18n.t('switcher.errorWithReason', { reason: error.message });
    }
  }
  return i18n.t('switcher.errorGeneric');
}
