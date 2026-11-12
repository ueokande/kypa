import { LineCounter, parseDocument } from "yaml";
import { EvidenceError } from "./errors.js";

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
    throw new EvidenceError(
      "INVALID_WORKFLOW",
      "Invalid YAML. Check syntax and duplicate keys.",
    );
  }
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 50 });
  } catch {
    throw new EvidenceError(
      "INVALID_WORKFLOW",
      "YAML aliases could not be resolved. Check aliases and reduce alias expansion.",
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new EvidenceError(
      "INVALID_WORKFLOW",
      "Expected a YAML mapping at the document root.",
    );
  }
  const object = data as Record<string, unknown>;
  const result: ActionReference[] = [];

  const record = (value: unknown, keys: (string | number)[]) => {
    if (typeof value !== "string") {
      throw new EvidenceError(
        "INVALID_WORKFLOW",
        "A uses value must be a string.",
      );
    }
    if (value.startsWith("$/") && value.includes("@")) {
      throw new EvidenceError(
        "INVALID_WORKFLOW",
        "Same-repository $/ references cannot specify @ref; they run at the workflow commit.",
      );
    }
    if (
      value.startsWith("./") ||
      value.startsWith("$/") ||
      value.startsWith("docker://")
    ) {
      return;
    }
    if (
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[^ @]+$/.test(
        value,
      ) ||
      [...value].some((character) => character.charCodeAt(0) <= 32)
    ) {
      throw new EvidenceError(
        "INVALID_WORKFLOW",
        "Unsupported uses reference. Use a local ./ or $/ path, a docker:// image, or owner/repository@ref.",
      );
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
      throw new EvidenceError(
        "INVALID_WORKFLOW",
        "Could not determine the source location of a uses reference.",
      );
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
      throw new EvidenceError(
        "INVALID_WORKFLOW",
        "The steps field must be a sequence.",
      );
    }
    value.forEach((step: unknown, index) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) {
        throw new EvidenceError(
          "INVALID_WORKFLOW",
          "Each step must be a YAML mapping.",
        );
      }
      if ("uses" in step) {
        record(step.uses, [...keys, index, "uses"]);
      }
    });
  };

  if (path.startsWith(".github/workflows/")) {
    const jobs = object.jobs;
    if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) {
      throw new EvidenceError(
        "INVALID_WORKFLOW",
        "The jobs field must be a YAML mapping.",
      );
    }
    for (const [id, job] of Object.entries(jobs)) {
      if (!job || typeof job !== "object" || Array.isArray(job)) {
        throw new EvidenceError(
          "INVALID_WORKFLOW",
          "Each job must be a YAML mapping.",
        );
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
      !("using" in runs) ||
      typeof runs.using !== "string"
    ) {
      throw new EvidenceError(
        "INVALID_WORKFLOW",
        "An Action manifest must contain runs.using.",
      );
    }
    if (
      runs.using !== "composite" &&
      runs.using !== "docker" &&
      !/^node\d+$/.test(runs.using)
    ) {
      throw new EvidenceError(
        "INVALID_WORKFLOW",
        "Unsupported Action runtime. Expected composite, docker, or a Node.js runtime.",
      );
    }
    if (runs.using === "composite") {
      if (!("steps" in runs)) {
        throw new EvidenceError(
          "INVALID_WORKFLOW",
          "A composite Action must contain runs.steps.",
        );
      }
      steps("steps" in runs ? runs.steps : undefined, ["runs", "steps"]);
    }
  }
  return result;
}
