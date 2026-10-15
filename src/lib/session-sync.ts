/** Keeps a background read from replacing a newer save or a different login. */
export class SessionSync {
  private session = 0;
  private revision = 0;
  private mutations = 0;
  private pending: Promise<void> | null = null;

  invalidate() {
    this.session += 1;
    this.revision += 1;
    this.mutations = 0;
    this.pending = null;
  }

  beginMutation(): () => void {
    const session = this.session;
    this.revision += 1;
    this.mutations += 1;
    return () => {
      if (session !== this.session) return;
      this.mutations -= 1;
      this.revision += 1;
    };
  }

  refresh(
    read: (guard: {
      canApply: () => boolean;
      sessionActive: () => boolean;
    }) => Promise<void>,
  ): Promise<void> {
    if (this.mutations) return Promise.resolve();
    if (this.pending) return this.pending;
    const session = this.session;
    const revision = this.revision;
    const pending = Promise.resolve()
      .then(() =>
        read({
          canApply: () =>
            session === this.session && revision === this.revision,
          sessionActive: () => session === this.session,
        }),
      )
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      });
    this.pending = pending;
    return pending;
  }
}

export const refreshInterval = (role: "admin" | "employee") =>
  role === "employee" ? 5000 : 60000;
