import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import type { LeadPrefill } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLeadPrefill } from "@/store/slices/onboardingSlice";

/** Forms opened from the A/B/C welcome links (?t=token): what we already know about the person. */
export function useLeadPrefill(): LeadPrefill | null {
  const [params] = useSearchParams();
  const token = params.get("t");
  const dispatch = useAppDispatch();
  const prefill = useAppSelector((s) => s.onboarding.prefill);
  useEffect(() => {
    if (token && /^[a-f0-9]{32}$/.test(token)) void dispatch(fetchLeadPrefill(token));
  }, [token, dispatch]);
  return token ? prefill : null;
}
