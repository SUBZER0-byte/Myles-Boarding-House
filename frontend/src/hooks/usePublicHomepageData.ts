import { useEffect, useRef, useState } from "react";
import { getPublicReviews, getPublicStats, type PublicReview, type PublicStats } from "@/lib/publicHomepage";

function toError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error("Could not load public homepage data.");
}

export function usePublicHomepageData(intervalMs = 10000) {
  const [reviews, setReviews] = useState<PublicReview[] | null>(null);
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [reviewsError, setReviewsError] = useState<Error | null>(null);
  const [statsError, setStatsError] = useState<Error | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const requestId = useRef(0);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const currentRequestId = ++requestId.current;
      const isCurrent = () => active && currentRequestId === requestId.current;

      const [reviewsResult, statsResult] = await Promise.allSettled([
        getPublicReviews(),
        getPublicStats(),
      ]);

      if (!isCurrent()) return;

      if (reviewsResult.status === "fulfilled") {
        setReviews(reviewsResult.value);
        setReviewsError(null);
      } else {
        setReviewsError(toError(reviewsResult.reason));
      }
      setReviewsLoading(false);

      if (statsResult.status === "fulfilled") {
        setStats(statsResult.value);
        setStatsError(null);
      } else {
        setStatsError(toError(statsResult.reason));
      }
      setStatsLoading(false);
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      active = false;
      requestId.current += 1;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return { reviews, stats, reviewsError, statsError, reviewsLoading, statsLoading };
}
