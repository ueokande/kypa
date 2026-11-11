const sha = "a".repeat(40);
const workflow =
  "jobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n";
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== "https://api.github.com") {
    throw new Error("Unexpected network destination.");
  }
  if (
    new Headers(init?.headers).get("authorization") !== "Bearer fixture-token"
  ) {
    throw new Error("Unexpected fixture authentication.");
  }
  const path = url.pathname;
  if (path === "/repos/fixture/target") {
    return Response.json({
      id: 42,
      full_name: "fixture/target",
      archived: false,
      fork: false,
      default_branch: "main",
    });
  }
  if (path === "/repos/fixture/target/commits/main") {
    return Response.json({ sha, commit: { tree: { sha } } });
  }
  if (path.startsWith("/repos/fixture/target/git/trees/")) {
    return Response.json({
      truncated: false,
      tree: [
        { path: ".github/workflows/ci.yml", mode: "100644", type: "blob", sha },
      ],
    });
  }
  if (path.startsWith("/repos/fixture/target/git/blobs/")) {
    return Response.json({
      encoding: "base64",
      content: Buffer.from(workflow).toString("base64"),
      size: Buffer.byteLength(workflow),
    });
  }
  if (path === "/repos/fixture/target/branches/main/protection") {
    return Response.json({
      required_pull_request_reviews: { required_approving_review_count: 1 },
    });
  }
  throw new Error("Unexpected fixture endpoint.");
};
