export type PreviewVisual =
  | {
      readonly kind: "image";
      readonly source: string;
      readonly title: string;
      readonly reference?: string;
      readonly documentPath?: string;
      readonly imageAlt?: string;
      readonly imageTitle?: string;
    }
  | { readonly kind: "mermaid"; readonly source: string; readonly title: string };
