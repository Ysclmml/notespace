export function installCodeMirrorDomMeasurementStubs(): void {
  const zeroRect = (): DOMRect => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
  });

  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = zeroRect;
  }
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => {
      const rects: DOMRect[] = [];
      return Object.assign(rects, {
        item: (index: number) => rects[index] ?? null,
      }) as unknown as DOMRectList;
    };
  }
  if (!HTMLElement.prototype.getBoundingClientRect) {
    HTMLElement.prototype.getBoundingClientRect = zeroRect;
  }
}

export function installImmediateIntersectionObserverStub(): void {
  class ImmediateIntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [0];

    constructor(private readonly callback: IntersectionObserverCallback) {}

    disconnect() {}

    observe(target: Element) {
      this.callback(
        [
          {
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRatio: 1,
            intersectionRect: target.getBoundingClientRect(),
            isIntersecting: true,
            rootBounds: null,
            target,
            time: performance.now(),
          },
        ],
        this as unknown as IntersectionObserver,
      );
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }

    unobserve() {}
  }

  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: ImmediateIntersectionObserver,
    writable: true,
  });
}
