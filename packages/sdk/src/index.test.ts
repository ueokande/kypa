import { expect, test } from "vitest";
import { resourceKey } from "./index.js";

test("resource identity includes provider, type, and stable ID", () => {
  expect(
    resourceKey({ provider: "github", type: "repository", id: "42" }),
  ).toBe("github/repository/42");
  expect(resourceKey({ provider: "cloud", type: "project", id: "42" })).toBe(
    "cloud/project/42",
  );
});
