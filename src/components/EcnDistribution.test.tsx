import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { EcnFormModal } from "./EcnFormModal";
import { EcnDistributionCard } from "./EcnDistributionCard";
import { EcnDistributionGroupsView } from "@/views/EcnDistributionGroupsView";
import { __resetEcnsForTests, getEcn, listEcns } from "@/api/ecns";
import { __resetEcnDistributionGroupsMockStore } from "@/api/ecnDistributionGroups";
import { ECN_DEFAULT_DISTRIBUTION } from "@/lib/ecnDistribution";

// =============================================================================
// ECN distribution on screen (BusinessIT#57): the New ECN form starts with
// the paper form's seven ticks, the ECN page shows who each ticked role
// reaches and whether it has been sent, and the groups screen is read-only to
// anyone who isn't an ARC admin.
// =============================================================================

const user = vi.hoisted(() => ({ current: { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 } }));

vi.mock("@/hooks/useCurrentUser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useCurrentUser")>();
  return {
    ...actual,
    useCurrentUser: () => user.current,
    useCurrentUserEmails: () => [user.current.email],
  };
});

beforeEach(() => {
  __resetEcnsForTests();
  __resetEcnDistributionGroupsMockStore();
  user.current = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 };
});

describe("New ECN", () => {
  it("starts with the paper form's seven roles ticked, and saves what is ticked", async () => {
    const onCreated = vi.fn();
    renderWithProviders(<EcnFormModal onClose={vi.fn()} onCreated={onCreated} />, {
      route: "/engineering/ecns",
      routePattern: "/engineering/ecns",
    });
    await screen.findByText(/Latest on the list is/);

    for (const role of ECN_DEFAULT_DISTRIBUTION) {
      expect(screen.getByRole("checkbox", { name: new RegExp(`^${role.replace(".", "\\.")}`) })).toBeChecked();
    }
    expect(screen.getByRole("checkbox", { name: /^CAD Department/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Panel Plant/ })).not.toBeChecked();

    await userEvent.click(screen.getByRole("checkbox", { name: /^CAD Department/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /^Sales/ }));
    await userEvent.type(screen.getByLabelText(/^Title/), "PCB ASSEMBLY");
    await userEvent.type(screen.getByLabelText(/^Log#/), "260777");
    await userEvent.click(screen.getByRole("button", { name: /raise ecn/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const created = (await listEcns()).find((e) => e.logNo === "260777")!;
    expect(created.distribution).toContain("CAD Department");
    expect(created.distribution).not.toContain("Sales");
    expect(created.distribution).toHaveLength(7);
  });
});

describe("the Distribution card", () => {
  it("says who each ticked role reaches, and warns about a role nobody is set up for", async () => {
    const ecn = (await getEcn(4))!;
    renderWithProviders(<EcnDistributionCard ecn={ecn} />);
    const card = await screen.findByTestId("ecn-distribution");
    await within(card).findByText("Quinn Quality");
    expect(within(card).getByText(/first time Sign-off status is filled in/)).toBeInTheDocument();
    expect(within(card).getByText(/Nobody is set up for Panel Plant/)).toBeInTheDocument();
  });

  it("shows who an ECN was sent to, once it was", async () => {
    const ecn = (await getEcn(3))!;
    renderWithProviders(<EcnDistributionCard ecn={ecn} />);
    expect(await screen.findByText(/Sent .* to Quinn Quality, Lee Logistics, Pat Production\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send now/i })).not.toBeInTheDocument();
  });

  it("offers Send now when signed off but never sent", async () => {
    const ecn = { ...(await getEcn(1))!, values: { ...(await getEcn(1))!.values, signOffStatus: "Approved" } };
    renderWithProviders(<EcnDistributionCard ecn={ecn} />);
    expect(await screen.findByRole("button", { name: /send now/i })).toBeEnabled();
  });

  it("edits the ticks in a dialog", async () => {
    const ecn = (await getEcn(1))!;
    renderWithProviders(<EcnDistributionCard ecn={ecn} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit Distribution" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Distribution" });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^Panel Plant/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(async () => expect((await getEcn(1))?.distribution).toContain("Panel Plant"));
  });
});

describe("the groups screen", () => {
  it("lets an ARC admin pick people", async () => {
    renderWithProviders(<EcnDistributionGroupsView />);
    await screen.findByText("Panel Plant");
    expect(screen.getAllByText("Nobody — add someone").length).toBeGreaterThan(0);
  });

  it("is read-only to everyone else", async () => {
    user.current = { displayName: "Kim Reader", email: "kim.reader@example.com", lookupId: 9 };
    renderWithProviders(<EcnDistributionGroupsView />);
    await screen.findByText("Panel Plant");
    await screen.findByText("Only ARC admins can change these groups.");
    expect(screen.queryByText("Nobody — add someone")).not.toBeInTheDocument();
  });
});
