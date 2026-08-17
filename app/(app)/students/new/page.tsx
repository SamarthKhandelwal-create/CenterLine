import { requireInstructor } from '@/lib/auth/current-user';
import { StudentForm } from '../student-form';

export default async function NewStudentPage() {
  await requireInstructor();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Add student</h1>
      <StudentForm />
    </div>
  );
}
