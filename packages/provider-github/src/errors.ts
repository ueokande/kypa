import { z } from "zod";
import { ApiError } from "./client.js";

export class EvidenceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function describeGitHubError(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof EvidenceError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof z.ZodError) {
    return {
      code: "INVALID_RESPONSE",
      message:
        "GitHub returned an unexpected response format. Check endpoint compatibility and try again.",
    };
  }
  if (!(error instanceof ApiError)) {
    return {
      code: "COLLECTION",
      message:
        "GitHub evidence could not be processed. Check the selected rules and required access.",
    };
  }
  const code = `GITHUB_${error.status}_${error.code}`;
  if (error.code === "TIMEOUT") {
    return {
      code,
      message:
        "The GitHub request timed out, including throttling and retries. Try a lower scan.concurrency or a higher scan.requestTimeoutSeconds.",
    };
  }
  if (error.code === "NETWORK") {
    return {
      code,
      message:
        "Could not connect to GitHub. Check network access, proxy settings, and TLS configuration.",
    };
  }
  if (error.code === "RATE_LIMIT") {
    return {
      code,
      message: `GitHub rate limit reached (HTTP ${error.status}). Retry later or lower scan.concurrency.`,
    };
  }
  if (error.status === 404) {
    return {
      code,
      message:
        "GitHub returned HTTP 404. The target may not exist or may be inaccessible to the token. Check its name, repository access, and organization approval or SSO requirements.",
    };
  }
  if (error.status === 403) {
    return {
      code,
      message:
        "GitHub returned HTTP 403. Check token permissions, organization approval, SSO authorization, and organization access policies.",
    };
  }
  if (error.status >= 500) {
    return {
      code,
      message: `GitHub returned HTTP ${error.status} after the configured retry policy. Retry later and check GitHub service status.`,
    };
  }
  if (error.code === "INVALID_RESPONSE") {
    return {
      code,
      message:
        "GitHub returned an invalid response. Check endpoint compatibility and try again.",
    };
  }
  return {
    code,
    message: `GitHub request failed with HTTP ${error.status}. Check the target and endpoint access requirements.`,
  };
}
