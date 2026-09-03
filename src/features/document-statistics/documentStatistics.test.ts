import { describe, expect, it, vi } from "vitest";

import {
  calculateDocumentStatistics,
  createDocumentStatisticsTask,
  STATISTICS_CHUNK_SIZE,
} from "./documentStatistics";
import { DocumentStatisticsCache, type StatisticsDocument } from "./statisticsCache";

describe("source document statistics", () => {
  it("updates for each unspaced Chinese insertion and deletion", () => {
    expect(calculateDocumentStatistics("中").wordCount).toBe(1);
    expect(calculateDocumentStatistics("中文").wordCount).toBe(2);
    expect(calculateDocumentStatistics("中文输入").wordCount).toBe(4);
    expect(calculateDocumentStatistics("中文输").wordCount).toBe(3);
  });

  it("counts CJK individually and other adjacent letters/numbers as words", () => {
    const result = calculateDocumentStatistics("你好NoteSpace 2026年 カナかな 한글 café");
    expect(result.wordCount).toBe(12);
    expect(calculateDocumentStatistics("hello-world foo_bar a1b2").wordCount).toBe(5);
    expect(calculateDocumentStatistics("Русский Ελληνικά العربية").wordCount).toBe(3);
  });

  it("counts non-BMP code points once and does not treat emoji as words", () => {
    expect(calculateDocumentStatistics("𠀀😀 e\u0301👩‍💻")).toEqual({
      wordCount: 2,
      characterCount: 8,
      characterCountWithoutSpaces: 7,
      lineCount: 1,
    });
  });

  it("reports empty and whitespace-only content consistently", () => {
    expect(calculateDocumentStatistics("")).toEqual({
      wordCount: 0,
      characterCount: 0,
      characterCountWithoutSpaces: 0,
      lineCount: 0,
    });
    expect(calculateDocumentStatistics(" \t\n\u3000\u00a0")).toEqual({
      wordCount: 0,
      characterCount: 5,
      characterCountWithoutSpaces: 0,
      lineCount: 2,
    });
  });

  it("counts physical LF, CR and CRLF source lines, including trailing blanks", () => {
    expect(calculateDocumentStatistics("a\r\nb\rc\n")).toEqual({
      wordCount: 3,
      characterCount: 7,
      characterCountWithoutSpaces: 3,
      lineCount: 4,
    });
    expect(calculateDocumentStatistics("\r\n").lineCount).toBe(2);
  });

  it("uses source consistently, including Markdown link destinations and code", () => {
    const source =
      "# 中文 **Hello**\n[label](https://example.com/page)\n```js\nconst x = 2;\n```";
    expect(calculateDocumentStatistics(source).wordCount).toBe(12);
    expect(calculateDocumentStatistics(source).characterCount).toBe([...source].length);
    expect(calculateDocumentStatistics("const 变量 = 42; // hello").wordCount).toBe(5);
    expect(calculateDocumentStatistics("# *** --- [] () !").wordCount).toBe(0);
  });

  it("preserves words, surrogate pairs, combining marks and CRLF across chunks", () => {
    const source = "hello123𠀀😀 café e\u0301\r\n中文\r\nend";
    for (const chunkSize of [1, 2, 3, 7, 12]) {
      const task = createDocumentStatisticsTask(source);
      let actual;
      let steps = 0;
      do {
        actual = task.advance(chunkSize);
        steps += 1;
      } while (!actual);
      expect(actual).toEqual(calculateDocumentStatistics(source));
      expect(steps).toBeGreaterThan(1);
    }
  });

  it("advances a synthetic large document in bounded slices without a different rule", () => {
    const line = "中文 hello123 😀\r\n";
    const repeatCount = Math.ceil((10 * 1024 * 1024) / line.length);
    const text = line.repeat(repeatCount);
    const task = createDocumentStatisticsTask(text);
    let statistics;
    let steps = 0;
    do {
      statistics = task.advance();
      steps += 1;
    } while (!statistics);
    expect(steps).toBeGreaterThanOrEqual(Math.floor(text.length / STATISTICS_CHUNK_SIZE));
    expect(statistics).toEqual({
      wordCount: 3 * repeatCount,
      characterCount: 15 * repeatCount,
      characterCountWithoutSpaces: 11 * repeatCount,
      lineCount: repeatCount + 1,
    });
  });
});

function document(id: string, text = "正文"): StatisticsDocument {
  return { id, text, kind: "markdown" };
}

describe("document statistics cache", () => {
  it("reuses the latest text across metadata changes and tab switches", () => {
    const cache = new DocumentStatisticsCache();
    const first = document("first");
    const second = document("second", "hello");
    const firstStatistics = calculateDocumentStatistics(first.text);
    cache.set(first, firstStatistics);
    cache.set(second, calculateDocumentStatistics(second.text));
    expect(cache.get(first)).toBe(firstStatistics);
    expect(cache.get({ ...first })).toBe(firstStatistics);
  });

  it("refreshes the weak reference after metadata-only session replacement", () => {
    const collected = new WeakSet<object>();
    const dereference = WeakRef.prototype.deref;
    vi.spyOn(WeakRef.prototype, "deref").mockImplementation(function (
      this: WeakRef<object>,
    ) {
      const target = dereference.call(this);
      return target && !collected.has(target) ? target : undefined;
    });
    const cache = new DocumentStatisticsCache();
    const original = document("first");
    const replacement = { ...original };
    const statistics = calculateDocumentStatistics(original.text);
    cache.set(original, statistics);
    expect(cache.get(replacement)).toBe(statistics);
    collected.add(original);
    expect(cache.get(replacement)).toBe(statistics);
    collected.add(replacement);
    expect(cache.get(replacement)).toBeUndefined();
  });

  it("invalidates local edits and same-path external reloads, even at the same length", () => {
    const cache = new DocumentStatisticsCache();
    const original = document("first", "test");
    cache.set(original, calculateDocumentStatistics(original.text));
    expect(cache.get(document("first", "中文内容"))).toBeUndefined();
    expect(cache.get(original)).toBeUndefined();
    cache.set(original, calculateDocumentStatistics(original.text));
    expect(cache.get({ ...original, kind: "text" })).toBeUndefined();
  });

  it("does not give a closed and reopened path stale content statistics", () => {
    const cache = new DocumentStatisticsCache();
    const closed = document("same-path", "old words");
    cache.set(closed, calculateDocumentStatistics(closed.text));
    const reopened = document("same-path", "新正文");
    expect(cache.get(reopened)).toBeUndefined();
    cache.set(reopened, calculateDocumentStatistics(reopened.text));
    expect(cache.get(reopened)?.wordCount).toBe(3);
  });

  it("bounds cached sessions to 32 and refreshes recently used entries", () => {
    const cache = new DocumentStatisticsCache();
    const documents = Array.from({ length: 33 }, (_, index) => document(`doc-${index}`));
    for (const item of documents.slice(0, 32)) {
      cache.set(item, calculateDocumentStatistics(item.text));
    }
    expect(cache.get(documents[0]!)).toBeDefined();
    cache.set(documents[32]!, calculateDocumentStatistics(documents[32]!.text));
    expect(cache.get(documents[0]!)).toBeDefined();
    expect(cache.get(documents[1]!)).toBeUndefined();
    expect(cache.get(documents[32]!)).toBeDefined();
  });
});
