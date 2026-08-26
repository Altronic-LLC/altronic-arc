import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSpecialPricing,
  deleteSpecialPricing,
  listSpecialPricing,
  updateSpecialPricing,
} from "@/api/specialPricing";
import type { SpecialPricingEntry, SpecialPricingInput } from "@/types/task";
import { pushToast } from "@/components/Toast";

export const SPECIAL_PRICING_KEY = ["specialPricing"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useSpecialPricingList() {
  return useQuery({
    queryKey: SPECIAL_PRICING_KEY,
    queryFn: listSpecialPricing,
    staleTime: 60_000,
  });
}

export function usePricingFor(customerId: number | null) {
  const { data: entries = [], ...rest } = useSpecialPricingList();
  return {
    ...rest,
    data: customerId === null ? [] : entries.filter((e) => e.customerId === customerId),
  };
}

export function useCreateSpecialPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SpecialPricingInput) => createSpecialPricing(input),
    onSuccess: (created) => {
      qc.setQueryData<SpecialPricingEntry[]>(SPECIAL_PRICING_KEY, (old) =>
        old ? [created, ...old] : [created],
      );
      pushToast({ message: `Added ${created.title || "pricing entry"}.` });
    },
    onError: (err: Error) => errorToast(`Couldn't add the pricing entry: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: SPECIAL_PRICING_KEY }),
  });
}

export function useUpdateSpecialPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changed }: { id: number; changed: Partial<SpecialPricingInput> }) =>
      updateSpecialPricing(id, changed),
    onSuccess: (updated) => {
      qc.setQueryData<SpecialPricingEntry[]>(SPECIAL_PRICING_KEY, (old) =>
        old?.map((e) => (e.id === updated.id ? updated : e)),
      );
    },
    onError: (err: Error) => errorToast(`Couldn't save that change: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: SPECIAL_PRICING_KEY }),
  });
}

export function useDeleteSpecialPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteSpecialPricing(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<SpecialPricingEntry[]>(SPECIAL_PRICING_KEY, (old) =>
        old?.filter((e) => e.id !== id),
      );
      pushToast({ message: "Pricing entry removed." });
    },
    onError: (err: Error) => errorToast(`Couldn't remove the pricing entry: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: SPECIAL_PRICING_KEY }),
  });
}
