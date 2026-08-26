import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSupplierContacts } from "@/hooks/useSupplierContacts";
import { LoadingTasks } from "@/components/LoadingTasks";

/**
 * /supply-chain/supplier-contact/:contactId — the deep-link target used by
 * contact-comment notification emails. Contacts don't have their own page;
 * they live on their supplier's detail page. This looks the contact up, then
 * forwards to /supply-chain/supplier/:supplierId?contact=:contactId so the
 * right card auto-expands and scrolls into view — the same arrangement as
 * BuildRequestItemRedirect.
 */
export function SupplierContactRedirect() {
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const { data: contacts, isLoading } = useSupplierContacts();

  useEffect(() => {
    if (!contacts) return;
    const id = contactId ? parseInt(contactId, 10) : NaN;
    const contact = contacts.find((c) => c.id === id);
    if (contact && contact.supplierId) {
      navigate(`/supply-chain/supplier/${contact.supplierId}?contact=${contact.id}`, { replace: true });
    } else if (!isLoading) {
      navigate("/supply-chain/suppliers", { replace: true });
    }
  }, [contacts, isLoading, contactId, navigate]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <LoadingTasks noun="this contact" />
    </div>
  );
}
