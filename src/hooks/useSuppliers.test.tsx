import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  collectSupplierPeople,
  useAddSupplierComment,
  useClearSupplierLogo,
  useCreateSupplier,
  useSupplier,
  useSuppliers,
  useUpdateSupplierDetails,
  useUpdateSupplierLogo,
} from "./useSuppliers";
import type { Supplier } from "@/types/task";

const notifyMentions = vi.hoisted(() =>
  vi.fn((_input: unknown) => Promise.resolve({ sent: [], failed: [] })),
);

vi.mock("@/api/email", () => ({ notifyMentions }));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));

const mention = (email: string, name: string) =>
  `<p><span class="mention" data-email="${email}">@${name}</span> please look</p>`;

function hookWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  notifyMentions.mockClear();
});

describe("useSuppliers", () => {
  it("loads the list", async () => {
    const { result } = renderHook(() => useSuppliers(), { wrapper: hookWrapper() });
    await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  });

  it("has nothing to show for a null id", async () => {
    const { result } = renderHook(() => useSupplier(null), { wrapper: hookWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeUndefined();
  });
});

describe("collectSupplierPeople", () => {
  it("gathers assigned buyer + watchers, deduped", () => {
    const s = (email: string): Supplier =>
      ({ assignedBuyer: { displayName: email, email }, watchers: [{ displayName: email, email }] }) as Supplier;
    const people = collectSupplierPeople([s("a@x.com"), s("a@x.com"), s("b@x.com")]);
    expect(people.map((p) => p.email).sort()).toEqual(["a@x.com", "b@x.com"]);
  });
});

describe("useCreateSupplier", () => {
  it("adds one and auto-watches the creator", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ create: useCreateSupplier(), list: useSuppliers() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.create.mutateAsync({
        companyName: "New Supplier Co",
        businessPartnerNumber: "999999",
        address: "",
        website: "",
        status: null,
        assignedBuyer: null,
        watchers: [],
      });
    });

    await waitFor(() => {
      const created = result.current.list.data?.find((s) => s.companyName === "New Supplier Co");
      expect(created).toBeDefined();
      expect(created?.watchers.some((w) => w.email === "ray.white@altronic-llc.com")).toBe(true);
    });
  });
});

describe("useUpdateSupplierLogo / useClearSupplierLogo", () => {
  it("uploads a logo, then removes it, patching the cache both times", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({
        update: useUpdateSupplierLogo(),
        clear: useClearSupplierLogo(),
        list: useSuppliers(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const current = result.current.list.data![0];
    const file = new File(["bytes"], "logo.png", { type: "image/png" });

    await act(async () => {
      await result.current.update.mutateAsync({ current, file });
    });
    await waitFor(() => {
      const updated = result.current.list.data?.find((s) => s.id === current.id);
      expect(updated?.logo?.originalImageName).toBe("logo.png");
    });

    const withLogo = result.current.list.data!.find((s) => s.id === current.id)!;
    await act(async () => {
      await result.current.clear.mutateAsync(withLogo);
    });
    await waitFor(() => {
      const cleared = result.current.list.data?.find((s) => s.id === current.id);
      expect(cleared?.logo).toBeNull();
    });
  });
});

describe("useUpdateSupplierDetails", () => {
  it("patches the cache and recomputes Title", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ update: useUpdateSupplierDetails(), list: useSuppliers() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const current = result.current.list.data![0];

    await act(async () => {
      await result.current.update.mutateAsync({ current, changed: { companyName: "Renamed Co" } });
    });

    await waitFor(() =>
      expect(result.current.list.data?.find((s) => s.id === current.id)?.companyName).toBe(
        "Renamed Co",
      ),
    );
  });
});

describe("useAddSupplierComment", () => {
  it("emails watchers and the assigned buyer, plus anyone mentioned", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddSupplierComment(), list: useSuppliers() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const supplier = result.current.list.data!.find((s) => s.id === 25)!; // has an assigned buyer + watcher fixture

    await act(async () => {
      await result.current.add.mutateAsync({
        id: supplier.id,
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: "<p>Checking in.</p>",
        },
      });
    });

    await waitFor(() => expect(notifyMentions).toHaveBeenCalled());
    const call = notifyMentions.mock.calls[0][0] as {
      recipients: Array<{ email: string }>;
      target: { kind: string };
    };
    expect(call.target.kind).toBe("supplier");
    expect(call.recipients.map((r) => r.email)).toContain("glenn.terry@altronic-llc.com");
  });

  it("auto-watches someone newly @-mentioned", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddSupplierComment(), list: useSuppliers() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const supplier = result.current.list.data!.find((s) => s.id === 29)!; // no watchers in the fixture

    await act(async () => {
      await result.current.add.mutateAsync({
        id: supplier.id,
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: mention("jerrod.waldron@altronic-llc.com", "Jerrod"),
        },
      });
    });

    await waitFor(() => {
      const updated = result.current.list.data?.find((s) => s.id === supplier.id);
      expect(updated?.watchers.some((w) => w.email === "jerrod.waldron@altronic-llc.com")).toBe(true);
    });
  });
});
