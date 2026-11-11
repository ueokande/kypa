import { LineCounter, parseDocument } from "yaml";

export interface ActionReference {
  reference: string;
  path: string;
  line: number;
  url: string;
}

export function collectReferences(
  text: string,
  path: string,
  repository: string,
  commit: string,
): ActionReference[] {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, uniqueKeys: true });
  if (doc.errors.length) {
    throw new Error("Invalid YAML.");
  }
  const data: unknown = doc.toJS({ maxAliasCount: 50 });
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Expected a YAML mapping.");
  }
  const object = data as Record<string, unknown>;
  const result: ActionReference[] = [];

  const record = (value: unknown, keys: (string | number)[]) => {
    if (typeof value !== "string") {
      throw new Error("Unsupported uses value.");
    }
    if (value.startsWith("./") || value.startsWith("docker://")) {
      return;
    }
    if (
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[^ @]+$/.test(
        value,
      ) ||
      [...value].some((character) => character.charCodeAt(0) <= 32)
    ) {
      throw new Error("Unsupported remote reference.");
    }
    const node = doc.getIn(keys, true);
    const range =
      node && typeof node === "object" && "range" in node
        ? node.range
        : undefined;
    const start =
      Array.isArray(range) && typeof range[0] === "number"
        ? range[0]
        : undefined;
    if (start === undefined) {
      throw new Error("Cannot locate reference.");
    }
    const line = lines.linePos(start).line;
    result.push({
      reference: value,
      path,
      line,
      url: `https://github.com/${repository}/blob/${commit}/${path.split("/").map(encodeURIComponent).join("/")}#L${line}`,
    });
  };

  const steps = (value: unknown, keys: (string | number)[]) => {
    if (value === undefined) {
      return;
    }
    if (!Array.isArray(value)) {
      throw new Error("Invalid steps.");
    }
    value.forEach((step: unknown, index) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) {
        throw new Error("Invalid step.");
      }
      if ("uses" in step) {
        record(step.uses, [...keys, index, "uses"]);
      }
    });
  };

  if (path.startsWith(".github/workflows/")) {
    const jobs = object.jobs;
    if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) {
      throw new Error("Invalid jobs.");
    }
    for (const [id, job] of Object.entries(jobs)) {
      if (!job || typeof job !== "object" || Array.isArray(job)) {
        throw new Error("Invalid job.");
      }
      if ("uses" in job) {
        record(job.uses, ["jobs", id, "uses"]);
      }
      steps("steps" in job ? job.steps : undefined, ["jobs", id, "steps"]);
    }
  } else {
    const runs = object.runs;
    if (
      !runs ||
      typeof runs !== "object" ||
      Array.isArray(runs) ||
      !("using" in runs)
    ) {
      throw new Error("Invalid Action manifest.");
    }
    if (runs.using === "composite") {
      steps("steps" in runs ? runs.steps : undefined, ["runs", "steps"]);
    }
  }
  return result;
}
