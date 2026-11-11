import { FatalError, type Policy, type Report } from "@kypa/sdk";
import { expect, test, vi } from "vitest";
import { run, type Toolkit } from "./index.js";

const report = {
  schemaVersion: 1,
  run: { id: "fixture", status: "partial" },
  scope: { evaluated: 1 },
  findings: [{}],
  errors: [{}],
} as Report;

function toolkit(failOn = "never"): Toolkit {
  return {
    getInput: (name) =>
      ({ token: "secret", config: "policy.yaml", "fail-on": failOn })[name] ??
      "",
    setSecret: vi.fn(),
    setOutput: vi.fn(),
    setFailed: vi.fn(),
    summary: {
      addHeading: vi.fn(),
      addRaw: vi.fn(),
      write: vi.fn(async () => {}),
    },
  };
}

const load = vi.fn(async () => ({
  policy: {} as Policy,
  directory: "/tmp",
  digest: "digest",
}));

test.each(["never", "violation", "error"])(
  "Action maps report outcomes for fail-on %s",
  async (failOn) => {
    const core = toolkit(failOn);
    const scan = vi.fn(async () => report);
    await run(core, { load, scan });
    expect(core.setSecret).toHaveBeenCalledWith("secret");
    expect(scan).toHaveBeenCalledWith({}, "/tmp", "digest", "secret");
    expect(core.setOutput).toHaveBeenCalledWith("status", "partial");
    expect(core.setOutput).toHaveBeenCalledWith("violation-count", 1);
    expect(core.summary.write).toHaveBeenCalledOnce();
    expect(core.setFailed).toHaveBeenCalledTimes(failOn === "never" ? 0 : 1);
  },
);

test("fatal failure is redacted, emits no report outputs, and never gets masked by never", async () => {
  const core = toolkit();
  await run(core, {
    load,
    scan: async () => {
      throw new Error("secret payload");
    },
  });
  expect(core.setOutput).not.toHaveBeenCalled();
  expect(core.setFailed).toHaveBeenCalledOnce();
  expect(JSON.stringify(vi.mocked(core.setFailed).mock.calls)).not.toContain(
    "secret payload",
  );
});

test("invalid input and unusable authentication fail before collection", async () => {
  const core = toolkit("unknown");
  const scan = vi.fn(async () => report);
  await run(core, { load, scan });
  expect(scan).not.toHaveBeenCalled();
  expect(core.setFailed).toHaveBeenCalled();
  const fatal = toolkit();
  await run(fatal, {
    load,
    scan: async () => {
      throw new FatalError("AUTHENTICATION", "secret");
    },
  });
  expect(fatal.setFailed).toHaveBeenCalledWith(
    expect.stringContaining("AUTHENTICATION"),
  );
});
