import { fireEvent, screen } from "@testing-library/react";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { renderWithProviders } from "@/test/render";

describe("ListAccessNotice", () => {
  it("explains the missing list access and offers a retry", () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <ListAccessNotice list="DE Terminal Digital QC" site="Altronic_Engineering" onRetry={onRetry} />,
    );

    expect(screen.getByText(/don't have access to this SharePoint list/i)).toBeInTheDocument();
    expect(screen.getByText(/DE Terminal Digital QC cannot load/i)).toBeInTheDocument();
    expect(screen.getByText("Altronic_Engineering")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
