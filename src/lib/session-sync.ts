export type RefreshKind = "full" | "prices";

/** Keeps a background read from replacing a newer save or a different login. */
export class SessionSync {
  private session = 0;
  private revision = 0;
  private mutations = 0;
  private pending: Promise<void> | null = null;
  private pendingKind: RefreshKind | null = null;
  private queuedFull: Promise<void> | null = null;

  invalidate() {
    this.session += 1;
    this.revision += 1;
    this.mutations = 0;
    this.pending = null;
    this.pendingKind = null;
    this.queuedFull = null;
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
    kind: RefreshKind = "full",
  ): Promise<void> {
    if (this.mutations) return Promise.resolve();
    if (this.pending) {
      if (kind === "prices" || this.pendingKind === "full") return this.pending;
      if (this.queuedFull) return this.queuedFull;
      const session = this.session;
      // A lightweight poll cannot satisfy an explicit full refresh. Wait for it
      // without overlapping reads, then honor the full request even if it failed.
      const queued = this.pending.catch(() => {}).then(() => {
        if (session === this.session) return this.refresh(read, "full");
      }).finally(() => {
        if (this.queuedFull === queued) this.queuedFull = null;
      });
      this.queuedFull = queued;
      return queued;
    }
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
        if (this.pending === pending) {
          this.pending = null;
          this.pendingKind = null;
        }
      });
    this.pending = pending;
    this.pendingKind = kind;
    return pending;
  }
}

export const refreshInterval = (role: "admin" | "employee") =>
  role === "employee" ? 5000 : 60000;
