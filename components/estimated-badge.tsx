import { Badge } from '@/components/ui/badge';

/**
 * An inferred time was never observed by anyone. Presenting it as if it were
 * observed would be a compliance violation dressed up as a feature, so every
 * surface that shows an inferred time shows this tag next to it, with the basis
 * available on hover or tap.
 */
export function EstimatedBadge({ basis }: { basis?: string | null }) {
  const reason = basis ?? 'inferred by the system';
  return (
    <Badge
      variant="amber"
      title={`Estimated — ${reason}. Not observed by staff.`}
      aria-label={`Estimated time, ${reason}, not observed by staff`}
      className="cursor-help align-middle"
    >
      Estimated
    </Badge>
  );
}
