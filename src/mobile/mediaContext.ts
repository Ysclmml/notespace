import { createContext } from "react";
import type { MobileVisual } from "./MobileVisualViewer";

export interface MobileMediaContextValue {
  readonly offline?: boolean;
  readonly loadImage?: (reference: string, signal: AbortSignal) => Promise<Blob>;
  readonly onOpenVisual?: (visual: MobileVisual) => void;
}

export const MobileMediaContext = createContext<MobileMediaContextValue>({});
