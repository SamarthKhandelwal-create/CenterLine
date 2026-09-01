import { requireInstructor } from '@/lib/auth/current-user';
import { StaffImportWizard } from './staff-import-wizard';

export default async function StaffImportPage() {
  await requireInstructor();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import staff</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add or update staff accounts from a spreadsheet. People are matched on their
          email address, so importing the same file twice changes nothing. Nobody is ever
          removed by an import, and no password is read from a file.
        </p>
      </div>
      <StaffImportWizard />
    </div>
  );
}
