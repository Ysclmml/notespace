export interface CustomDocumentTemplate {
  readonly path: string;
  readonly title: string;
  readonly sizeBytes: number;
}

export interface DocumentTemplateLibrary {
  readonly directoryPath: string;
  readonly templates: readonly CustomDocumentTemplate[];
  readonly skippedCount: number;
  readonly truncated: boolean;
}

export interface TemplateLibraryAdapter {
  list(): Promise<DocumentTemplateLibrary>;
  read(path: string): Promise<CustomDocumentTemplate & { readonly markdown: string }>;
  save(name: string, content: string): Promise<CustomDocumentTemplate>;
  openDirectory(path: string): Promise<void>;
}

export const MAX_TEMPLATE_BYTES = 256 * 1024;
