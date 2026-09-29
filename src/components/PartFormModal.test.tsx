import { beforeEach, describe, expect, it, vi } from "vitest";

// Toasts render in the app shell's container, which a unit render doesn't
// have — so assert the call.
const pushToast = vi.hoisted(() => vi.fn());
vi.mock("./Toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./Toast")>();
  return { ...actual, pushToast };
});
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { __resetPartsRolesMockStore } from "@/api/partsRoles";
import { __resetAltronicPartsMockStore, deleteAltronicPart, listAltronicParts } from "@/api/altronicParts";
import { __resetAltronicComponentsMockStore, listAltronicComponents } from "@/api/altronicComponents";
import { __resetComponentDescriptionOptionsMockStore } from "@/api/componentDescriptionOptions";
import { __resetDatasheetsMockStore, findDatasheet, uploadDatasheet } from "@/api/datasheets";

vi.mock("@/api/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/email")>();
  return { ...actual, notifyChangeEmails: vi.fn(async () => ({ sent: [], failed: [] })) };
});

import { NewPartButton, PartFormModal } from "./PartFormModal";

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderForm(prefix: string | null) {
  const onClose = vi.fn();
  const view = renderWithProviders(
    <Routes>
      <Route path="/" element={<PartFormModal prefix={prefix} onClose={onClose} />} />
      <Route path="*" element={<Where />} />
    </Routes>,
  );
  return { onClose, unmount: view.unmount };
}

beforeEach(() => {
  localStorage.clear();
  __resetPartsRolesMockStore();
  __resetAltronicPartsMockStore();
  __resetAltronicComponentsMockStore();
  __resetDatasheetsMockStore();
  __resetComponentDescriptionOptionsMockStore();
  pushToast.mockClear();
});

describe("PartFormModal — a Part List part", () => {
  it("fills in the next free number in the list", async () => {
    renderForm("604");
    // Mock list 604 holds 604596 and 604612.
    await waitFor(() => expect(screen.getByLabelText("Altronic Part #")).toHaveValue("604613"));
  });

  it("shows the Part List fields, and not SAP # — that's the SAP admin's", async () => {
    renderForm("604");
    expect(await screen.findByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Not Purchased" })).toBeInTheDocument();
    expect(screen.queryByLabelText("SAP #")).not.toBeInTheDocument();
    expect(screen.getByText(/Goes on the/)).toHaveTextContent("Part List");
  });

  it("names every missing required field, and saves nothing", async () => {
    renderForm("604");
    await waitFor(() => expect(screen.getByLabelText("Altronic Part #")).toHaveValue("604613"));
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));
    expect(await screen.findByText(/Fill in: Description, Assigned By, Prototype or Production, Purchased\./)).toBeInTheDocument();
    expect((await listAltronicParts()).some((p) => p.partNumber === "604613")).toBe(false);
  });

  it("refuses a number from another list", async () => {
    renderForm("604");
    const pn = screen.getByLabelText("Altronic Part #");
    await waitFor(() => expect(pn).toHaveValue("604613"));
    await userEvent.clear(pn);
    await userEvent.type(pn, "605001");
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));
    expect(await screen.findByText("A part in list 604 must start with 604.")).toBeInTheDocument();
  });

  it("refuses a number that's already taken", async () => {
    renderForm("604");
    const pn = screen.getByLabelText("Altronic Part #");
    await waitFor(() => expect(pn).toHaveValue("604613"));
    await userEvent.clear(pn);
    await userEvent.type(pn, "604596");
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));
    expect(await screen.findByText("604596 is already on the parts list.")).toBeInTheDocument();
  });

  it("adds the part at Pending SAP and opens it", async () => {
    const { onClose } = renderForm("604");
    await waitFor(() => expect(screen.getByLabelText("Altronic Part #")).toHaveValue("604613"));
    await userEvent.type(screen.getByLabelText("Description"), "Connector, test");
    await userEvent.type(screen.getByLabelText("Assigned By"), "TW");
    await userEvent.click(screen.getByRole("radio", { name: "Production" }));
    await userEvent.click(screen.getByRole("radio", { name: "Purchased" }));
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const created = (await listAltronicParts()).find((p) => p.partNumber === "604613")!;
    expect(created).toMatchObject({
      description: "Connector, test",
      assignedBy: "TW",
      prototypeOrProduction: "Production",
      purchased: "Purchased",
      signOffStatus: "Pending SAP",
    });
    // Date Assigned defaults to today.
    expect(created.dateAssigned).not.toBeNull();
    expect(screen.getByTestId("where")).toHaveTextContent(`/engineering/parts/part/${created.id}`);
  });
});

/** Open a searchable dropdown by its name and pick an option from it. */
async function pick(control: string, option: string) {
  await userEvent.click(await screen.findByRole("button", { name: control }));
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

/** Everything a 701 component needs except its description. */
async function fillComponentExceptDescription() {
  // Next free fills the number in once the lists load.
  await waitFor(() => expect(screen.getByLabelText("Altronic Part #")).not.toHaveValue(""));
  await userEvent.type(screen.getByLabelText("Mfg Name"), "KEMET");
  await userEvent.type(screen.getByLabelText("Mfg Number"), "C0805C104K5RACTU");
  await userEvent.type(screen.getByLabelText(/^Rating A/), ".1UF");
  await userEvent.type(screen.getByLabelText(/^Rating B/), "50V");
  await userEvent.type(screen.getByLabelText(/^Rating C/), "X7R");
  await userEvent.type(screen.getByLabelText("Temp Min"), "-55C");
  await userEvent.type(screen.getByLabelText("Temp Max"), "125C");
  await userEvent.type(screen.getByLabelText("Tolerance"), "10%");
  await userEvent.type(screen.getByLabelText("Footprint"), "0805");
}

describe("PartFormModal — a component", () => {
  it("switches to the component fields and names the ratings for the type", async () => {
    renderForm("701");
    await screen.findByRole("button", { name: "Description" });
    expect(screen.getByText(/Component List/)).toBeInTheDocument();
    await pick("Description", "Resistor");
    expect(await screen.findByText(/Rating A — Resistance/)).toBeInTheDocument();
    expect(screen.getByText(/Rating C — Power/)).toBeInTheDocument();
  });

  it("follows the number typed on the Parts Book — a 601 is a component", async () => {
    renderForm(null);
    await userEvent.type(screen.getByLabelText("Altronic Part #"), "601900");
    expect(await screen.findByText(/as Through Hole/)).toBeInTheDocument();
    expect(screen.getByLabelText("Mfg Name")).toBeInTheDocument();
  });

  it("keeps 722 to HCO editors", async () => {
    __resetPartsRolesMockStore([
      { id: 1, email: "demo.user@altronic-llc.com", displayName: "Demo User", roles: ["editor"], note: "" },
    ]);
    renderForm("722");
    expect(await screen.findByText(/Only HCO editors can add to the 722 list/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add part" })).toBeDisabled();
  });
});

describe("PartFormModal — a component's description is picked", () => {
  it("keeps Type disabled until a Description is picked, then offers only its types", async () => {
    renderForm("701");
    const type = await screen.findByRole("button", { name: "Type" });
    expect(type).toBeDisabled();
    await pick("Description", "Capacitor");
    expect(screen.getByRole("button", { name: "Type" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Type" }));
    expect(screen.getByRole("option", { name: "Ceramic" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Wirewound" })).not.toBeInTheDocument();
  });

  it("saves the two joined in capitals", async () => {
    const { onClose } = renderForm("701");
    await screen.findByRole("button", { name: "Description" });
    await pick("Description", "Capacitor");
    await pick("Type", "Ceramic");
    expect(screen.getByText("CAPACITOR - CERAMIC")).toBeInTheDocument();
    await fillComponentExceptDescription();
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The newest row — the mock data already holds a CAPACITOR - CERAMIC.
    const created = (await listAltronicComponents()).reduce((a, b) => (b.id > a.id ? b : a));
    expect(created).toMatchObject({
      description: "CAPACITOR - CERAMIC",
      category: "Surface Mount",
      signOffStatus: "Pending Engineering Review",
    });
  });

  it("says which pick is missing", async () => {
    renderForm("701");
    await waitFor(() => expect(screen.getByLabelText("Altronic Part #")).not.toHaveValue(""));
    await pick("Description", "Capacitor");
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));
    expect(await screen.findByText(/^Pick a Type for Capacitor\. Also fill in:/)).toBeInTheDocument();
  });

  it("puts a SIL category first on the 722 list, and requires it", async () => {
    const { onClose } = renderForm("722");
    await screen.findByRole("radiogroup", { name: "SIL category" });
    await pick("Description", "Capacitor");
    await pick("Type", "Ceramic");
    await fillComponentExceptDescription();
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));
    expect(await screen.findByText("Pick the SIL category.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "SIL CAT 2" }));
    expect(screen.getByText("SIL CAT 2 - CAPACITOR - CERAMIC")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await listAltronicComponents()).some((c) => c.description === "SIL CAT 2 - CAPACITOR - CERAMIC")).toBe(true);
  });

  it("offers no SIL category off the 722 list", async () => {
    renderForm("701");
    await screen.findByRole("button", { name: "Description" });
    expect(screen.queryByRole("radiogroup", { name: "SIL category" })).not.toBeInTheDocument();
  });

  it("offers what's on the list today — an option added is offered, one removed isn't", async () => {
    __resetComponentDescriptionOptionsMockStore([
      { id: 1, kind: "Description", name: "Fuse", types: ["Glass"], sortOrder: 10 },
    ]);
    renderForm("701");
    await userEvent.click(await screen.findByRole("button", { name: "Description" }));
    expect(screen.getByRole("option", { name: "Fuse" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Capacitor" })).not.toBeInTheDocument();
  });

  it("keeps the plain box when the list has no descriptions", async () => {
    __resetComponentDescriptionOptionsMockStore([]);
    renderForm("701");
    expect(await screen.findByRole("textbox", { name: "Description" })).toBeInTheDocument();
  });

  it("leaves a Part List part's description as a text box", async () => {
    renderForm("604");
    expect(await screen.findByRole("textbox", { name: "Description" })).toBeInTheDocument();
  });
});

describe("PartFormModal — the datasheet", () => {
  const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], "USB4105 datasheet.pdf", { type: "application/pdf" });

  async function fillPart() {
    await waitFor(() => expect(screen.getByLabelText("Altronic Part #")).toHaveValue("604613"));
    await userEvent.type(screen.getByLabelText("Description"), "Connector, test");
    await userEvent.type(screen.getByLabelText("Assigned By"), "TW");
    await userEvent.click(screen.getByRole("radio", { name: "Production" }));
    await userEvent.click(screen.getByRole("radio", { name: "Purchased" }));
  }

  it("says what the file will be called", async () => {
    renderForm("604");
    await waitFor(() => expect(screen.getByLabelText("Altronic Part #")).toHaveValue("604613"));
    expect(screen.getByText("604613.pdf")).toBeInTheDocument();
  });

  it("uploads the PDF as <part #>.pdf once the part is added", async () => {
    const { onClose } = renderForm("604");
    await fillPart();
    await userEvent.upload(screen.getByLabelText("Datasheet PDF"), pdf());
    expect(screen.getByText(/USB4105 datasheet\.pdf/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await listAltronicParts()).some((p) => p.partNumber === "604613")).toBe(true);
    expect(await findDatasheet("604613")).toMatchObject({ name: "604613.pdf" });
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("refuses a file that isn't a PDF BEFORE adding the part", async () => {
    renderForm("604");
    await fillPart();
    await userEvent.setup({ applyAccept: false }).upload(
      screen.getByLabelText("Datasheet PDF"),
      new File(["x"], "notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));

    expect(await screen.findByText(/"notes\.docx" isn't a PDF/)).toBeInTheDocument();
    expect((await listAltronicParts()).some((p) => p.partNumber === "604613")).toBe(false);
  });

  it("still adds the part when the upload fails — and says how to retry", async () => {
    // A 604613.pdf is already in the folder, so the upload is refused.
    await uploadDatasheet("604613", pdf());
    const { onClose } = renderForm("604");
    await fillPart();
    await userEvent.upload(screen.getByLabelText("Datasheet PDF"), pdf());
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await listAltronicParts()).some((p) => p.partNumber === "604613")).toBe(true);
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/604613 was added, but its datasheet didn't upload — 604613\.pdf is already in the Datasheets folder, so it wasn't replaced/),
        variant: "error",
      }),
    );
  });

  it("doesn't ask Has Data Sheet on a new component — the upload decides it", async () => {
    renderForm("701");
    await screen.findByRole("button", { name: "Description" });
    expect(screen.queryByText("Has Data Sheet")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Datasheet PDF")).toBeInTheDocument();
  });
});

describe("PartFormModal — the draft", () => {
  it("keeps what was typed if the form is closed and opened again", async () => {
    const first = renderForm("604");
    await userEvent.type(await screen.findByLabelText("Description"), "Half-typed");
    // Unmounting is what flushes the pending draft write — navigating away.
    first.unmount();
    renderForm("604");
    expect(await screen.findByLabelText("Description")).toHaveValue("Half-typed");
    expect(screen.getByText(/Draft restored/i)).toBeInTheDocument();
  });
});

describe("NewPartButton", () => {
  it("shows for somebody who can add, and opens the form", async () => {
    renderWithProviders(<NewPartButton prefix="604" />);
    const button = await screen.findByRole("button", { name: "New part" });
    // Disabled while the roles list loads — neither yes nor no yet.
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(within(screen.getByRole("dialog")).getByText("New part in list 604")).toBeInTheDocument();
  });

  it("is hidden from somebody without a role — the list is read by everyone", async () => {
    __resetPartsRolesMockStore([]);
    renderWithProviders(<NewPartButton prefix="604" />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "New part" })).not.toBeInTheDocument());
  });
});

describe("PartFormModal — reusing a deleted number", () => {
  const sheila = { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com" };

  it("offers the lowest deleted number in the list before a new one, and says it's a reuse", async () => {
    // Mock list 604 holds 604596 (part 12) and 604612 (part 23).
    await deleteAltronicPart(23, "604612", "Duplicate", sheila);
    await deleteAltronicPart(12, "604596", "Never built", sheila);
    renderForm("604");
    await waitFor(() => expect(screen.getByLabelText("Altronic Part #")).toHaveValue("604596"));
    expect(screen.getByText(/is a deleted number/)).toBeInTheDocument();
  });

  it("reuses the deleted row when the part is added — no second row", async () => {
    await deleteAltronicPart(12, "604596", "Never built", sheila);
    const before = (await listAltronicParts()).length;
    const { onClose } = renderForm("604");
    await waitFor(() => expect(screen.getByLabelText("Altronic Part #")).toHaveValue("604596"));
    await userEvent.type(screen.getByLabelText("Description"), "Connector, reuse test");
    await userEvent.type(screen.getByLabelText("Assigned By"), "TW");
    await userEvent.click(screen.getByRole("radio", { name: "Production" }));
    await userEvent.click(screen.getByRole("radio", { name: "Purchased" }));
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const after = await listAltronicParts();
    expect(after).toHaveLength(before);
    expect(after.find((p) => p.id === 12)).toMatchObject({
      partNumber: "604596",
      description: "Connector, reuse test",
      signOffStatus: "Pending SAP",
      manufacturer: "",
    });
    expect(screen.getByTestId("where")).toHaveTextContent("/engineering/parts/part/12");
  });

  it("accepts a deleted number typed by hand, where a live one is refused", async () => {
    await deleteAltronicPart(12, "604596", "Never built", sheila);
    renderForm("604");
    const pn = screen.getByLabelText("Altronic Part #");
    await waitFor(() => expect(pn).toHaveValue("604596"));
    await userEvent.clear(pn);
    await userEvent.type(pn, "604612");
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));
    expect(await screen.findByText("604612 is already on the parts list.")).toBeInTheDocument();
  });
});
