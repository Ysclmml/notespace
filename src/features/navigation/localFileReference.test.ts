import { describe, expect, it } from "vitest";

import { localFileReferenceFromText } from "./localFileReference";

describe("localFileReferenceFromText", () => {
  it("recognizes relative and absolute source references with line numbers", () => {
    expect(localFileReferenceFromText("process/core/cl_process.py:61")).toEqual({
      reference: "process/core/cl_process.py:61",
      path: "process/core/cl_process.py",
      line: 61,
    });
    expect(localFileReferenceFromText("</tmp/worker.rs:8>")).toEqual({
      reference: "/tmp/worker.rs:8",
      path: "/tmp/worker.rs",
      line: 8,
    });
  });

  it("ignores ordinary inline code and remote URLs", () => {
    expect(localFileReferenceFromText("new_subscriber_online")).toBeNull();
    expect(localFileReferenceFromText("https://example.com/a.py:4")).toBeNull();
  });

  it.each([
    "handlers/**/urls.py",
    "handlers/*/urls.py:12",
    "src/worker?.py",
    "`handlers/**/urls.py`",
    "server/src/run_<app>.py",
    "<app>/start.py:8",
    "</tmp/<app>/worker.rs:8>",
    "src/${app}/start.py",
    "src/{{app}}/start.py",
    "src/{http,mq}/urls.py",
    "C:\\code\\**\\worker.py:12",
    "file:///tmp/*/worker.py:12",
  ])("does not infer a concrete file from the pattern %s", (value) => {
    expect(localFileReferenceFromText(value)).toBeNull();
  });

  it.each([
    "./src/worker.py",
    "../示例 代码/worker.py",
    "app/[slug]/page.tsx",
    "app/[...slug]/page.tsx",
    "app/[[...slug]]/page.tsx",
    "src/{draft}/worker.py",
    "src/$worker.py",
    "\\\\server\\share\\worker.py",
    "\\\\?\\C:\\code\\worker.py",
    "\\\\?\\UNC\\server\\share\\worker.py",
    "file:///tmp/example%20code/worker.py",
  ])("preserves literal path syntax in %s", (path) => {
    expect(localFileReferenceFromText(`${path}:12`)).toEqual({
      reference: `${path}:12`,
      path,
      line: 12,
    });
  });

  it("distinguishes a bare filename with a line number from an unsupported URI", () => {
    expect(localFileReferenceFromText("worker.py:12")).toEqual({
      reference: "worker.py:12",
      path: "worker.py",
      line: 12,
    });
    expect(localFileReferenceFromText("C:\\code\\worker.py:12")?.line).toBe(12);
    expect(localFileReferenceFromText("file:///tmp/worker.py:12")?.line).toBe(12);
    for (const value of [
      "ftp://example.test/worker.py:12",
      "javascript:worker.py",
      "custom:worker.py:12",
      "data:text/plain,worker.py",
    ])
      expect(localFileReferenceFromText(value)).toBeNull();
  });

  it("stays aligned with the extended desktop code suffix set", () => {
    for (const extension of [
      "cs",
      "rb",
      "php",
      "swift",
      "kt",
      "kts",
      "lua",
      "dart",
      "scala",
      "groovy",
      "pl",
      "pm",
      "proto",
      "graphql",
      "gql",
    ]) {
      expect(localFileReferenceFromText(`src/example.${extension}:9`)).toEqual({
        reference: `src/example.${extension}:9`,
        path: `src/example.${extension}`,
        line: 9,
      });
    }
  });
});
