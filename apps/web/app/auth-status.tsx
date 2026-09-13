interface AuthStatusProps {
  readonly userId?: string | undefined;
  readonly signInAction: () => Promise<never>;
  readonly signOutAction: () => Promise<never>;
}

export function AuthStatus({
  userId,
  signInAction,
  signOutAction,
}: AuthStatusProps) {
  if (!userId) {
    return (
      <section aria-label="Authentication">
        <p>You are signed out.</p>
        <form action={signInAction}>
          <button type="submit">Sign in with GitHub</button>
        </form>
      </section>
    );
  }

  return (
    <section aria-label="Authentication">
      <p>You are signed in.</p>
      <p>User ID: {userId}</p>
      <form action={signOutAction}>
        <button type="submit">Sign out</button>
      </form>
    </section>
  );
}
