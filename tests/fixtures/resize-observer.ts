/**
 * Installs a `ResizeObserver` on happy-dom's window that a test delivers by hand; happy-dom's own
 * never calls back. As in a browser, a newly observed element is due one report.
 */
export function stubResizeObserver(): {
  /** Reports every element that is due one, as a browser does after layout. */
  deliver: () => void;
  /** Reports every observed element, as when each one's size changed. */
  resizeAll: () => void;
  restore: () => void;
} {
  const original = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
  const observers = new Set<ResizeObserverStub>();

  class ResizeObserverStub {
    readonly observed = new Set<Element>();
    readonly due = new Set<Element>();

    constructor(readonly callback: ResizeObserverCallback) {
      observers.add(this);
    }

    observe(target: Element) {
      this.observed.add(target);
      this.due.add(target);
    }

    unobserve(target: Element) {
      this.observed.delete(target);
      this.due.delete(target);
    }

    disconnect() {
      this.observed.clear();
      this.due.clear();
    }

    deliver() {
      const entries = [...this.due].map((target) => ({ target }) as ResizeObserverEntry);
      this.due.clear();
      if (entries.length) this.callback(entries, this as unknown as ResizeObserver);
    }
  }

  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverStub,
  });

  const deliver = () => {
    for (const observer of observers) observer.deliver();
  };
  return {
    deliver,
    resizeAll() {
      for (const observer of observers)
        for (const target of observer.observed) observer.due.add(target);
      deliver();
    },
    restore() {
      if (original) Object.defineProperty(window, "ResizeObserver", original);
      else Reflect.deleteProperty(window, "ResizeObserver");
    },
  };
}
