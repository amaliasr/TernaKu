export const LAYER_KEY = "ternakuLayer";
export type CloseLayer = () => void | boolean;
type Layer = { id: string; hash: string; close: CloseLayer };
export interface HistoryPort {
  state(): Record<string, unknown>;
  hash(): string;
  push(state: Record<string, unknown>, hash?: string): void;
  replace(state: Record<string, unknown>): void;
  go(delta: number): void;
  changed(): void;
}

/** Keep temporary views in browser history so Android Back closes the top view. */
export class BackStack {
  private layers: Layer[] = [];
  private pendingBack = false;
  private pendingHash: string | null = null;
  private retired = new Set<string>();
  private waiting: {
    close: CloseLayer;
    cancelled: boolean;
    release?: () => void;
  }[] = [];
  private sequence = 0;
  constructor(private port: HistoryPort) {}
  private cleanState() {
    const state = { ...this.port.state() };
    delete state[LAYER_KEY];
    return state;
  }
  open(close: CloseLayer): () => void {
    if (this.pendingBack) {
      const item = { close, cancelled: false } as (typeof this.waiting)[number];
      this.waiting.push(item);
      return () => {
        item.cancelled = true;
        item.release?.();
      };
    }
    const id = `view-${++this.sequence}-${Date.now()}`;
    this.layers.push({ id, hash: this.port.hash(), close });
    this.port.push({ ...this.port.state(), [LAYER_KEY]: id });
    return () => {
      const index = this.layers.findIndex((layer) => layer.id === id);
      if (index < 0) return;
      this.layers.splice(index, 1);
      this.retired.add(id);
      if (this.port.state()[LAYER_KEY] === id) {
        this.pendingBack = true;
        this.port.go(-1);
      }
    };
  }
  pop() {
    const id = this.port.state()[LAYER_KEY];
    // Parent and nested overlays may unmount together (for example on logout).
    // Skip their abandoned entries, also when Forward reaches a closed overlay.
    if (typeof id === "string" && this.retired.has(id)) {
      this.pendingBack = true;
      this.port.go(-1);
      return;
    }
    this.pendingBack = false;
    while (this.layers.length && this.layers.at(-1)!.id !== id) {
      const layer = this.layers.pop()!;
      if (layer.close() === false) {
        this.layers.push(layer);
        // A busy save or a cancelled warning keeps its form open. Restore all
        // surviving overlays crossed by Back without losing the parent's view.
        const parent = this.layers.findIndex((item) => item.id === id);
        const remainingLayers = this.layers.slice(parent + 1);
        if (parent < 0 && this.port.hash() !== remainingLayers[0].hash) {
          this.port.push(this.cleanState(), remainingLayers[0].hash);
        }
        for (const remaining of remainingLayers) {
          this.port.push(
            { ...this.cleanState(), [LAYER_KEY]: remaining.id },
            remaining.hash,
          );
        }
        this.pendingHash = null;
        break;
      }
      this.retired.add(layer.id);
    }
    // Forward navigation must not resurrect a closed form with unsaved data.
    const currentId = this.port.state()[LAYER_KEY];
    if (currentId && !this.layers.some((layer) => layer.id === currentId))
      this.port.replace(this.cleanState());
    if (this.pendingHash !== null) {
      const hash = this.pendingHash;
      this.pendingHash = null;
      this.navigate(hash);
      if (this.pendingBack) return;
    }
    this.port.changed();
    for (const item of this.waiting.splice(0)) {
      if (!item.cancelled) item.release = this.open(item.close);
    }
  }
  navigate(hash: string) {
    if (this.pendingBack) {
      this.pendingHash = hash;
      return;
    }
    let closed = 0;
    let blocked = false;
    while (this.layers.length) {
      const layer = this.layers.pop()!;
      if (layer.close() === false) {
        this.layers.push(layer);
        blocked = true;
        break;
      }
      this.retired.add(layer.id);
      closed++;
    }
    if (closed) {
      this.pendingHash = blocked ? null : hash;
      this.pendingBack = true;
      this.port.go(-closed);
    } else if (!blocked) {
      this.port.push(this.cleanState(), hash);
      this.port.changed();
    }
  }
}
