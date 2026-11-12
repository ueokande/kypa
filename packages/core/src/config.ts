import * as crypto from "node:crypto";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { FatalError, type Policy, type Rule, severities } from "@kypa/sdk";
import { parseDocument } from "yaml";
import { z } from "zod";
import { policyDiagnostics } from "./config-diagnostics.js";

const component = "[A-Za-z0-9_.-]+";
const repository = z.string().regex(new RegExp(`^${component}/${component}$`));
const pattern = z
  .string()
  .regex(/^[A-Za-z0-9_.*-]+\/[A-Za-z0-9_.*-]+$/)
  .refine((value) => !value.includes("**"));
const options = z
  .object({
    enabled: z.boolean().default(true),
    severity: z.enum(severities).optional(),
    parameters: z.unknown().optional(),
  })
  .strict();
const rawPolicy = z
  .object({
    version: z.literal(1),
    targets: z
      .object({
        orgs: z
          .array(z.string().regex(new RegExp(`^${component}$`)))
          .default([]),
        repos: z.array(repository).default([]),
        exclude: z.array(pattern).default([]),
        includeArchived: z.boolean().default(false),
        includeForks: z.boolean().default(false),
      })
      .strict()
      .refine((value) => value.orgs.length + value.repos.length > 0),
    scan: z
      .object({
        concurrency: z.number().int().min(1).max(64).default(4),
        retries: z.number().int().min(0).max(10).default(3),
        requestTimeoutSeconds: z.number().int().min(1).max(300).default(30),
      })
      .strict()
      .default({ concurrency: 4, retries: 3, requestTimeoutSeconds: 30 }),
    rules: z.record(z.string(), options),
    reporters: z
      .array(
        z.discriminatedUnion("name", [
          z
            .object({
              name: z.literal("json"),
              options: z.object({ path: z.string().min(1) }).strict(),
            })
            .strict(),
          z
            .object({
              name: z.literal("html"),
              options: z
                .object({
                  directory: z.string().min(1),
                  basePath: z.string().regex(/^\/(?:[A-Za-z0-9_-]+\/)*$/),
                })
                .strict(),
            })
            .strict(),
        ]),
      )
      .min(1),
  })
  .strict();

export function parsePolicy(text: string, rules: readonly Rule[]): Policy {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) {
    throw new FatalError(
      "CONFIG",
      "Policy YAML is invalid or contains duplicate keys.",
      doc.errors.slice(0, 10).map((error) => {
        const position = error.linePos?.[0];
        const location = position
          ? ` at line ${position.line}, column ${position.col}`
          : "";
        return error.code === "DUPLICATE_KEY"
          ? `Duplicate YAML key${location}. Remove duplicate entries.`
          : `Invalid YAML${location}. Check indentation, mappings, and sequences.`;
      }),
    );
  }
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 50 });
  } catch {
    throw new FatalError("CONFIG", "Policy YAML could not be read.", [
      "Policy YAML aliases could not be resolved. Use plain values or reduce alias expansion.",
    ]);
  }
  const parsed = rawPolicy.safeParse(data);
  if (!parsed.success) {
    throw new FatalError(
      "CONFIG",
      "Policy fields are invalid; check the configuration reference.",
      policyDiagnostics(
        parsed.error.issues,
        new Set(rules.map((rule) => rule.id)),
      ),
    );
  }
  const registry = new Map(rules.map((rule) => [rule.id, rule]));
  if (registry.size !== rules.length) {
    throw new FatalError("REGISTRY", "Duplicate rule IDs.");
  }
  const selected: Policy["rules"] = [];
  for (const [id, setting] of Object.entries(parsed.data.rules)) {
    const rule = registry.get(id);
    if (!rule) {
      throw new FatalError("CONFIG", "Policy selects an unknown rule.", [
        `rules: Unknown rule selected. Available rules: ${[...registry.keys()].join(", ")}.`,
      ]);
    }
    let parameters: unknown;
    try {
      parameters = rule.validateParameters(setting.parameters ?? {});
    } catch (error) {
      throw new FatalError(
        "CONFIG",
        "Rule parameters are invalid.",
        error instanceof z.ZodError
          ? policyDiagnostics(
              error.issues.map((issue) => ({
                ...issue,
                path: ["rules", id, "parameters", ...issue.path],
              })),
              new Set(registry.keys()),
            )
          : [
              `rules["${id}"].parameters: Invalid parameters. Check this rule's configuration reference.`,
            ],
      );
    }
    if (setting.enabled) {
      selected.push({
        id,
        severity: setting.severity ?? rule.defaultSeverity,
        parameters,
      });
    }
  }
  if (!selected.length) {
    throw new FatalError("CONFIG", "At least one enabled rule is required.", [
      "rules: Select at least one rule with enabled: true (the default).",
    ]);
  }
  return { ...parsed.data, rules: selected };
}

export function matchesPattern(name: string, pattern: string): boolean {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${escaped}$`, "i").test(name);
}

export function within(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return (
    rel === "" ||
    (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`))
  );
}

async function canonical(localPath: string): Promise<string> {
  try {
    return await fsPromises.realpath(localPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    const parent = path.dirname(localPath);
    if (parent === localPath) {
      return localPath;
    }
    return path.resolve(
      await canonical(parent),
      path.relative(parent, localPath),
    );
  }
}

export async function loadPolicy(
  localPath: string,
  rules: readonly Rule[],
): Promise<{ policy: Policy; directory: string; digest: string }> {
  let policyPath: string;
  let text: string;
  try {
    policyPath = await fsPromises.realpath(path.resolve(localPath));
    text = await fsPromises.readFile(policyPath, "utf8");
  } catch {
    throw new FatalError("CONFIG_FILE", "Cannot read the policy file.", [
      "Cannot read the policy file. Check the configuration file path and read permissions.",
    ]);
  }
  const directory = path.dirname(policyPath);
  const policy = parsePolicy(text, rules);
  const destinations: string[] = [];
  for (const [index, reporter] of policy.reporters.entries()) {
    const field = `reporters[${index}].options.${reporter.name === "json" ? "path" : "directory"}`;
    const destination = await canonical(
      path.resolve(
        directory,
        reporter.options.path ?? reporter.options.directory ?? "",
      ),
    );
    if (
      !within(directory, destination) ||
      destination === directory ||
      within(destination, policyPath)
    ) {
      throw new FatalError(
        "OUTPUT_PATH",
        "Outputs must be dedicated paths beneath the policy directory.",
        [
          `${field}: Choose a dedicated path beneath the policy directory that does not contain the policy file.`,
        ],
      );
    }
    for (const other of destinations) {
      if (within(other, destination) || within(destination, other)) {
        throw new FatalError("OUTPUT_PATH", "Reporter destinations overlap.", [
          `${field}: Output destinations overlap. Use separate, non-nested paths for each reporter.`,
        ]);
      }
    }
    try {
      await fsPromises.lstat(destination);
      throw new FatalError(
        "OUTPUT_PATH",
        "Output destination already exists; use a fresh generated destination.",
        [
          `${field}: Output destination already exists. Choose a fresh destination or remove only previously generated output.`,
        ],
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    destinations.push(destination);
  }
  return {
    policy,
    directory,
    digest: crypto.createHash("sha256").update(text).digest("hex"),
  };
}
