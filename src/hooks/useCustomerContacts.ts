import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCustomerContact,
  deleteCustomerContact,
  listCustomerContacts,
  updateCustomerContact,
} from "@/api/customerContacts";
import type { CustomerContact, CustomerContactInput } from "@/types/task";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Customer Contacts hooks. The whole list is fetched once and scoped to one
// customer in the component (useContactsFor) — same shape as the Teradyne
// reference lists, since this is a small maintained list, not a work queue.
// =============================================================================

export const CUSTOMER_CONTACTS_KEY = ["customerContacts"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useCustomerContacts() {
  return useQuery({
    queryKey: CUSTOMER_CONTACTS_KEY,
    queryFn: listCustomerContacts,
    staleTime: 60_000,
  });
}

/** Every contact for one customer, name ascending (already sorted by the API). */
export function useContactsFor(customerId: number | null) {
  const { data: contacts = [], ...rest } = useCustomerContacts();
  return {
    ...rest,
    data: customerId === null ? [] : contacts.filter((c) => c.customerId === customerId),
  };
}

export function useCreateCustomerContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerContactInput) => createCustomerContact(input),
    onSuccess: (created) => {
      qc.setQueryData<CustomerContact[]>(CUSTOMER_CONTACTS_KEY, (old) =>
        old ? [created, ...old] : [created],
      );
      pushToast({ message: `Added ${created.name || "contact"}.` });
    },
    onError: (err: Error) => errorToast(`Couldn't add the contact: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: CUSTOMER_CONTACTS_KEY }),
  });
}

export function useUpdateCustomerContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changed }: { id: number; changed: Partial<CustomerContactInput> }) =>
      updateCustomerContact(id, changed),
    onSuccess: (updated) => {
      qc.setQueryData<CustomerContact[]>(CUSTOMER_CONTACTS_KEY, (old) =>
        old?.map((c) => (c.id === updated.id ? updated : c)),
      );
    },
    onError: (err: Error) => errorToast(`Couldn't save that change: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: CUSTOMER_CONTACTS_KEY }),
  });
}

export function useDeleteCustomerContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCustomerContact(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<CustomerContact[]>(CUSTOMER_CONTACTS_KEY, (old) =>
        old?.filter((c) => c.id !== id),
      );
      pushToast({ message: "Contact removed." });
    },
    onError: (err: Error) => errorToast(`Couldn't remove the contact: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: CUSTOMER_CONTACTS_KEY }),
  });
}
