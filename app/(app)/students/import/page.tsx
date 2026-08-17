import { requireInstructor } from '@/lib/auth/current-user';
import { ImportWizard } from './import-wizard';

export default async function ImportPage() {
  await requireInstructor();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import roster</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop in a CSV or Excel export from your existing system. Columns are detected
          automatically, and importing the same file twice changes nothing.
        </p>
      </div>
      <ImportWizard />
    </div>
  );
}
