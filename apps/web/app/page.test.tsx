import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("renders the product identifier", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: "AI Developer Brand Copilot" })
    ).toBeInTheDocument();
  });
});
