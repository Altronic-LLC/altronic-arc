import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { quoteOriginHeaderHtml } from "@/lib/quoteToTask";
import { FromQuoteLink } from "./FromQuoteLink";

const comment = (bodyHtml: string) => ({
  timestamp: new Date(),
  authorName: "Ray",
  authorEmail: "ray@x.com",
  bodyHtml,
  attachments: [],
});

describe("FromQuoteLink", () => {
  it("links a task created from a quote back to that quote", () => {
    renderWithProviders(
      <FromQuoteLink
        comments={[comment("<p>later</p>"), comment(quoteOriginHeaderHtml({ id: 3, quoteBase: "IQ-WAB-0002", quoteNumber: "IQ-WAB-0002-R1" }, true))]}
      />,
    );
    const link = screen.getByRole("link", { name: /From quote: IQ-WAB-0002-R1/ });
    expect(link).toHaveAttribute("href", "/sales/quotes/3");
  });

  it("shows nothing on any other task", () => {
    renderWithProviders(<FromQuoteLink comments={[comment("<p>hi</p>")]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
