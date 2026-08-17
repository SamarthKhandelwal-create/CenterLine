'use client';

import { ErrorRecovery } from '@/components/error-recovery';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorRecovery error={error} reset={reset} />;
}
