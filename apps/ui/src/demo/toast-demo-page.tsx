import { Button } from '@/components/common/button';
import { notify } from '@/components/common/sonner';

// Dev-only page for comparing the toasts against the Figma designs.

const DEMOS = [
  { label: 'Success', show: () => notify.success('Tenant created') },
  { label: 'Info', show: () => notify.info('Your changes will sync shortly') },
  { label: 'Warning', show: () => notify.warning('Session expires soon') },
  { label: 'Danger', show: () => notify.danger('Could not save changes') },
  {
    label: 'Long message',
    show: () =>
      notify.success(
        'The connector was created and the credentials were stored securely for later use by this tenant',
      ),
  },
];

export function ToastDemoPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Toast demo</h1>
      <div className="flex flex-wrap gap-2">
        {DEMOS.map(({ label, show }) => (
          <Button key={label} variant="outline" onClick={show}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
