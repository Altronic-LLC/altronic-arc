import { beforeEach, describe, expect, it, vi } from "vitest";

// Toasts render in the app shell's container, which a unit render doesn't
// have — so assert the call.
const pushToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/Toast")>();
  return { ...actual, pushToast };
});
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPartsRolesMockStore } from "@/api/partsRoles";
import { __resetAltronicPartsMockStore } from "@/api/altronicParts";
import { __resetAltronicComponentsMockStore, deleteAltronicComponent, listAltronicComponents } from "@/api/altronicComponents";
import { __resetDatasheetsMockStore, findDatasheet } from "@/api/datasheets";
import { PartDetailView } from "./PartDetailView";

// Mock mode: the demo user holds every Parts Roles tag unless a test empties
// the store (see api/partsRoles.ts).

function renderPart(route: string) {
  return renderWithProviders(<PartDetailView />, { route, routePattern: "/engineering/parts/:kind/:id" });
}

beforeEach(() => {
  __resetPartsRolesMockStore();
  __resetAltronicPartsMockStore();
  __resetAltronicComponentsMockStore();
  __resetDatasheetsMockStore();
  pushToast.mockClear();
});

describe("PartDetailView — a Part List part", () => {
  it("shows the part's fields by card", async () => {
    // Mock part 9: 504017, Panduit, legacy.
    renderPart("/engineering/parts/part/9");
    expect(await screen.findByRole("heading", { name: "504017" })).toBeInTheDocument();
    expect(screen.getAllByText("Lug - Terminal - Stakeproof - 2 AWG").length).toBeGreaterThan(0);
    expect(screen.getByText("Panduit")).toBeInTheDocument();
    expect(screen.getByText("LCA2-14-L")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "List 504" })).toHaveAttribute("href", "/engineering/parts/list/504");
  });

  it("explains a blank sign-off on a part loaded from the old app, and offers no approval", async () => {
    renderPart("/engineering/parts/part/9");
    expect((await screen.findAllByText("Not tracked")).length).toBeGreaterThan(0);
    expect(screen.getByText(/didn't record approvals/)).toBeInTheDocument();
    expect(screen.getByText("504#17")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("shows the submitter on a part added in ARC", async () => {
    // Mock part 23: raised since the move by Brandon, Pending SAP.
    renderPart("/engineering/parts/part/23");
    expect((await screen.findAllByText("Pending SAP")).length).toBeGreaterThan(0);
    expect(screen.getByText("Added in ARC")).toBeInTheDocument();
    expect(screen.getByText("Brandon Mirto")).toBeInTheDocument();
    expect(screen.queryByText(/didn't record approvals/)).not.toBeInTheDocument();
  });

  it("says so when the part isn't on the list", async () => {
    renderPart("/engineering/parts/part/99999");
    expect(await screen.findByText("That part isn't on the list.")).toBeInTheDocument();
  });
});

describe("PartDetailView — editing", () => {
  it("offers an Edit button per card to somebody with the role", async () => {
    renderPart("/engineering/parts/part/9");
    expect(await screen.findByRole("button", { name: "Edit Purchasing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Drawing" })).toBeInTheDocument();
  });

  it("saves an edit and shows the new value", async () => {
    renderPart("/engineering/parts/part/9");
    await userEvent.click(await screen.findByRole("button", { name: "Edit Purchasing" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Purchasing" });
    await userEvent.type(within(dialog).getByLabelText("SAP #"), "1000-0009-00");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("1000-0009-00")).toBeInTheDocument();
  });

  it("refuses to blank a required field, and saves nothing", async () => {
    renderPart("/engineering/parts/part/9");
    await userEvent.click(await screen.findByRole("button", { name: "Edit Drawing" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Drawing" });
    const assignedBy = within(dialog).getByLabelText("Assigned By");
    // Part 9 has no Assigned By, so give it one, then try blanking it again.
    await userEvent.clear(assignedBy);
    await userEvent.type(assignedBy, "GT");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("GT")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit Drawing" }));
    const again = screen.getByRole("dialog", { name: "Edit Drawing" });
    await userEvent.clear(within(again).getByLabelText("Assigned By"));
    pushToast.mockClear();
    await userEvent.click(within(again).getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/can't be left blank/) })),
    );
    expect(screen.getByText("GT")).toBeInTheDocument();
  });

  it("offers no Edit to somebody without a role, and says who can", async () => {
    __resetPartsRolesMockStore([]);
    renderPart("/engineering/parts/part/9");
    expect(await screen.findByRole("heading", { name: "504017" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/limited to Engineering/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  });

  it("keeps HOC components to HOC editors — an editor alone can't change one", async () => {
    __resetPartsRolesMockStore([
      { id: 1, email: "demo.user@altronic-llc.com", displayName: "Demo User", roles: ["editor"], note: "" },
    ]);
    renderPart("/engineering/parts/component/1");
    expect(await screen.findByRole("heading", { name: "601110" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/only be edited by HOC editors/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  });
});

describe("PartDetailView — approval", () => {
  it("approves a component's engineering review with a comment, and records it", async () => {
    // Mock component 17: 701990, Pending Engineering Review.
    renderPart("/engineering/parts/component/17");
    expect(await screen.findByText(/Waiting on an engineering review/)).toBeInTheDocument();
    // The button appears once the roles list has loaded.
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("dialog", { name: "Approve" });
    await userEvent.type(within(dialog).getByRole("textbox"), "Checked against the datasheet");
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    expect(await screen.findByText(/Waiting on the SAP admin/)).toBeInTheDocument();
    expect(screen.getByText("Approval history")).toBeInTheDocument();
    expect(screen.getByText("Checked against the datasheet")).toBeInTheDocument();
  });

  it("shows an earlier approval in the history", async () => {
    // Mock component 18 was reviewed by Glenn before it reached Pending SAP.
    renderPart("/engineering/parts/component/18");
    expect(await screen.findByText("Approval history")).toBeInTheDocument();
    expect(screen.getByText(/Corrected the forward voltage/)).toBeInTheDocument();
  });

  it("tells somebody who can't approve who it's waiting on, without a button", async () => {
    __resetPartsRolesMockStore([
      { id: 1, email: "demo.user@altronic-llc.com", displayName: "Demo User", roles: ["editor"], note: "" },
    ]);
    renderPart("/engineering/parts/part/23");
    expect(await screen.findByText(/Waiting on the SAP admin/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Waiting on the SAP admin to add it to SAP/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("an SAP admin who is not a reviewing engineer can't do the engineering step", async () => {
    __resetPartsRolesMockStore([
      { id: 1, email: "demo.user@altronic-llc.com", displayName: "Demo User", roles: ["sap admin"], note: "" },
    ]);
    renderPart("/engineering/parts/component/17");
    expect(await screen.findByText(/Waiting on an engineering review/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Waiting on a reviewing engineer.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    // …but can still edit every field.
    expect(screen.getByRole("button", { name: "Edit Ratings" })).toBeInTheDocument();
  });
});

describe("PartDetailView — the datasheet", () => {
  // Mock datasheets (see MOCK_DATASHEET_PART_NUMBERS): components 5 (601466)
  // and 13 (712044) flagged with a file; 10 (701212) flagged, no file;
  // 1 (601110) not flagged, but a file.

  it("links to the datasheet when the file is there", async () => {
    renderPart("/engineering/parts/component/5");
    const link = await screen.findByRole("link", { name: /Open datasheet/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("/Shared%20Documents/General/Datasheets/601466.pdf"));
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("finds a datasheet the Has Data Sheet flag says isn't there — and says so", async () => {
    renderPart("/engineering/parts/component/1");
    expect(await screen.findByRole("link", { name: /Open datasheet/ })).toBeInTheDocument();
    expect(screen.getByText(/though Has Data Sheet is set to No/)).toBeInTheDocument();
  });

  it("says so when the flag is set but the file is missing", async () => {
    renderPart("/engineering/parts/component/10");
    expect(await screen.findByText(/no 701212\.pdf in the Datasheets folder/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open datasheet/ })).not.toBeInTheDocument();
  });

  it("just says No when neither the flag nor the folder has one", async () => {
    // Component 2, 601138: not flagged, no file. A reader, so no Upload.
    __resetPartsRolesMockStore([]);
    renderPart("/engineering/parts/component/2");
    const label = await screen.findByText("Datasheet");
    await waitFor(() => expect(label.nextElementSibling).toHaveTextContent("No"));
    expect(screen.queryByText(/Datasheets folder/)).not.toBeInTheDocument();
  });

  it("links a Part List part's datasheet too — with no flag to disagree with", async () => {
    // Part 4, 204602: in the folder. The Part List has no Has Data Sheet column.
    renderPart("/engineering/parts/part/4");
    const link = await screen.findByRole("link", { name: /Open datasheet/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("/General/Datasheets/204602.pdf"));
    expect(screen.queryByText(/Has Data Sheet/)).not.toBeInTheDocument();
  });

  it("says No on a Part List part with no datasheet, and nothing about a flag", async () => {
    // Part 1, 101022: not in the folder. A reader, so no Upload.
    __resetPartsRolesMockStore([]);
    renderPart("/engineering/parts/part/1");
    const label = await screen.findByText("Datasheet");
    await waitFor(() => expect(label.nextElementSibling).toHaveTextContent("No"));
    expect(screen.queryByText(/Has Data Sheet/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upload datasheet/ })).not.toBeInTheDocument();
  });
});

describe("PartDetailView — uploading a datasheet", () => {
  const pdf = (name = "sheet.pdf") => new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });

  it("lets an editor upload one to a Part List part that has none", async () => {
    // Part 1, 101022: no file.
    renderPart("/engineering/parts/part/1");
    await screen.findByRole("button", { name: /Upload datasheet/ });
    await userEvent.upload(screen.getByLabelText("Datasheet PDF"), pdf());

    expect(await screen.findByRole("link", { name: /Open datasheet/ })).toHaveAttribute(
      "href",
      expect.stringContaining("/General/Datasheets/101022.pdf"),
    );
    expect(await findDatasheet("101022")).not.toBeNull();
    expect(pushToast).toHaveBeenCalledWith({ message: "101022.pdf uploaded." });
  });

  it("sets Has Data Sheet on a component once the file has landed", async () => {
    // Component 2, 601138: not flagged, no file.
    renderPart("/engineering/parts/component/2");
    await screen.findByRole("button", { name: /Upload datasheet/ });
    await userEvent.upload(screen.getByLabelText("Datasheet PDF"), pdf());

    await screen.findByRole("link", { name: /Open datasheet/ });
    await waitFor(async () =>
      expect((await listAltronicComponents()).find((c) => c.id === 2)?.hasDataSheet).toBe(true),
    );
    // Flag and folder now agree, so there's nothing to point out.
    expect(screen.queryByText(/Has Data Sheet is set to/)).not.toBeInTheDocument();
  });

  it("refuses a file that isn't a PDF, and uploads nothing", async () => {
    renderPart("/engineering/parts/part/1");
    await screen.findByRole("button", { name: /Upload datasheet/ });
    // applyAccept off: the picker's filter is only a hint in a real browser too.
    await userEvent.setup({ applyAccept: false }).upload(
      screen.getByLabelText("Datasheet PDF"),
      new File(["x"], "drawing.dwg", { type: "application/octet-stream" }),
    );
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/isn't a PDF/), variant: "error" }));
    expect(await findDatasheet("101022")).toBeNull();
  });

  it("offers no Upload to somebody who can't edit HOC components", async () => {
    __resetPartsRolesMockStore([
      { id: 1, email: "demo.user@altronic-llc.com", displayName: "Demo User", roles: ["editor"], note: "" },
    ]);
    renderPart("/engineering/parts/component/2");
    const label = await screen.findByText("Datasheet");
    await waitFor(() => expect(label.nextElementSibling).toHaveTextContent("No"));
    expect(screen.queryByRole("button", { name: /Upload datasheet/ })).not.toBeInTheDocument();
  });
});

describe("PartDetailView — a Component List part", () => {
  it("labels the ratings with what they mean for this component type", async () => {
    // Mock component 2: 601138, CAPACITOR - CERAMIC.
    renderPart("/engineering/parts/component/2");
    expect(await screen.findByRole("heading", { name: "601138" })).toBeInTheDocument();
    expect(screen.getByText("Capacitance")).toBeInTheDocument();
    expect(screen.getByText("Temp coef")).toBeInTheDocument();
    expect(screen.getByText("1000pF")).toBeInTheDocument();
    expect(screen.getByText("Through Hole")).toBeInTheDocument();
  });

  it("keeps the generic names for a type the entry rules don't cover", async () => {
    // Mock component 13: an IC.
    renderPart("/engineering/parts/component/13");
    expect(await screen.findByText("Rating A")).toBeInTheDocument();
    expect(screen.getByText(/doesn't name a component type/)).toBeInTheDocument();
  });

  it("treats an unknown kind in the URL as not found", async () => {
    renderPart("/engineering/parts/widget/1");
    expect(await screen.findByText("That part isn't on the list.")).toBeInTheDocument();
  });
});

describe("PartDetailView — deleting a part number", () => {
  const SAP_ONLY = [{ id: 1, email: "demo.user@altronic-llc.com", displayName: "Demo User", roles: ["sap admin" as const], note: "" }];
  const HOC_ONLY = [{ id: 1, email: "demo.user@altronic-llc.com", displayName: "Demo User", roles: ["hoc editor" as const, "reviewing engineer" as const], note: "" }];

  it("offers Delete to the SAP admin only — hidden from everybody else", async () => {
    __resetPartsRolesMockStore(HOC_ONLY);
    const first = renderPart("/engineering/parts/part/4");
    await screen.findByRole("heading", { name: "204602" });
    await waitFor(() => expect(screen.queryByText(/Checking your Parts List roles/)).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Delete part number/ })).not.toBeInTheDocument();
    first.unmount();

    __resetPartsRolesMockStore(SAP_ONLY);
    renderPart("/engineering/parts/part/4");
    expect(await screen.findByRole("button", { name: /Delete part number/ })).toBeInTheDocument();
  });

  it("needs a reason AND the number typed back before it will delete", async () => {
    __resetPartsRolesMockStore(SAP_ONLY);
    renderPart("/engineering/parts/part/4");
    await userEvent.click(await screen.findByRole("button", { name: /Delete part number/ }));
    const dialog = screen.getByRole("dialog", { name: "Delete part number" });
    const confirm = within(dialog).getByRole("button", { name: "Delete part number" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Raised by mistake");
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Confirm part number"), "204602");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    // The page becomes the deleted notice, with who and why.
    expect(await screen.findByText("This part number was deleted.")).toBeInTheDocument();
    expect(screen.getByText(/Deleted by Demo User/)).toBeInTheDocument();
    expect(screen.getByText(/Raised by mistake/)).toBeInTheDocument();
    expect(pushToast).toHaveBeenCalledWith({ message: expect.stringMatching(/204602 was deleted/) });
  });

  it("shows a deleted part's link as deleted, not a page of blanks", async () => {
    await deleteAltronicComponent(5, "601466", "Duplicate", { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com" });
    renderPart("/engineering/parts/component/5");
    expect(await screen.findByText("This part number was deleted.")).toBeInTheDocument();
    expect(screen.getByText(/Deleted by Sheila Horn/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open list 601" })).toHaveAttribute("href", "/engineering/parts/list/601");
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
  });
});
