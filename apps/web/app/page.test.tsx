import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthStatus } from "./auth-status";

const action = async (): Promise<never> =>
  Promise.reject(new Error("not called in render tests"));

describe("AuthStatus", () => {
  it("renders the signed-out state and GitHub sign-in action", () => {
    render(<AuthStatus signInAction={action} signOutAction={action} />);

    expect(screen.getByText("You are signed out.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in with GitHub" })
    ).toBeInTheDocument();
  });

  it("renders the restored authenticated state and sign-out action", () => {
    const userId = "123e4567-e89b-42d3-a456-426614174000";

    render(
      <AuthStatus
        userId={userId}
        signInAction={action}
        signOutAction={action}
      />
    );

    expect(screen.getByText("You are signed in.")).toBeInTheDocument();
    expect(screen.getByText(`User ID: ${userId}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
