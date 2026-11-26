import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { getPublicReviews, getPublicStats, type PublicReview, type PublicStats } from "@/lib/publicHomepage";

function toError(message: string | null): Error | null {
  return message ? new Error(message) : null;
}

export function usePublicHomepageData(intervalMs = 10000) {
  const reviewsResult = useSupabasePolling<PublicReview[]>(getPublicReviews, intervalMs);
  const statsResult = useSupabasePolling<PublicStats>(getPublicStats, intervalMs);

  return {
    reviews: reviewsResult.data,
    stats: statsResult.data,
    reviewsError: toError(reviewsResult.error),
    statsError: toError(statsResult.error),
    reviewsLoading: reviewsResult.loading,
    statsLoading: statsResult.loading,
  };
}
