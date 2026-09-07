interface OverlayEntry {
  id: symbol;
  visible: boolean;
  zIndex: number;
  order: number;
}

export interface OverlayStackRegistration {
  setVisible(visible: boolean): void;
  setZIndex(zIndex: number): void;
  isTop(): boolean;
  unregister(): void;
}

const entries: OverlayEntry[] = [];
let nextOrder = 0;

const getTopEntry = (): OverlayEntry | undefined => {
  let top: OverlayEntry | undefined;
  for (const entry of entries) {
    if (!entry.visible) continue;
    if (!top || entry.zIndex > top.zIndex || (entry.zIndex === top.zIndex && entry.order > top.order)) top = entry;
  }
  return top;
};

export const overlayStack = {
  register(visible: boolean, zIndex: number): OverlayStackRegistration {
    const entry: OverlayEntry = { id: Symbol('overlay'), visible, zIndex, order: ++nextOrder };
    entries.push(entry);
    let registered = true;

    return {
      setVisible(nextVisible) {
        if (!registered) return;
        if (nextVisible && !entry.visible) entry.order = ++nextOrder;
        entry.visible = nextVisible;
      },
      setZIndex(nextZIndex) {
        if (registered) entry.zIndex = nextZIndex;
      },
      isTop() {
        return registered && entry.visible && getTopEntry()?.id === entry.id;
      },
      unregister() {
        if (!registered) return;
        registered = false;
        const index = entries.indexOf(entry);
        if (index >= 0) entries.splice(index, 1);
      },
    };
  },
};
