import { describe, expect, it } from "vitest";
import {
  FAVORITES_STORAGE_KEY,
  loadFavorites,
  MAX_FAVORITES,
  normalizeFavorites,
  relocateFavorite,
  saveFavorites,
  toggleFavorite,
} from "./favorites";

describe("path-only favorites", () => {
  it("normalizes bounded real paths and rejects drafts and extra data", () => {
    expect(
      normalizeFavorites([
        "/notes/中文.md",
        "/notes/中文.md",
        "C:\\Notes\\a.md",
        "c:/notes/A.md",
        "untitled://note.md",
        "relative.md",
        { path: "/body.md", body: "private" },
        "/bad\u0000.md",
      ]),
    ).toEqual(["/notes/中文.md", "C:\\Notes\\a.md"]);
    expect(
      normalizeFavorites(Array.from({ length: 120 }, (_, i) => `/notes/${i}.md`)),
    ).toHaveLength(MAX_FAVORITES);
  });
  it("toggles without affecting files and migrates Save As without duplicate entries", () => {
    expect(toggleFavorite(["/one.md"], "/two.md")).toEqual(["/one.md", "/two.md"]);
    expect(toggleFavorite(["C:\\notes\\a.md"], "c:/notes/A.md")).toEqual([]);
    expect(relocateFavorite(["/one.md", "/two.md"], "/one.md", "/two.md")).toEqual([
      "/two.md",
    ]);
  });
  it("round-trips only paths and tolerates damaged/unavailable storage", () => {
    let saved = "";
    const storage = {
      getItem: () => saved,
      setItem: (key: string, value: string) => {
        expect(key).toBe(FAVORITES_STORAGE_KEY);
        saved = value;
      },
    };
    saveFavorites(["/notes/a.md"], storage);
    expect(saved).toBe('["/notes/a.md"]');
    expect(loadFavorites(storage)).toEqual(["/notes/a.md"]);
    saved = "{";
    expect(loadFavorites(storage)).toEqual([]);
    const unavailable = {
      getItem: () => {
        throw Error();
      },
      setItem: () => {
        throw Error();
      },
    };
    expect(loadFavorites(unavailable)).toEqual([]);
    expect(() => saveFavorites(["/x.md"], unavailable)).not.toThrow();
  });
});
