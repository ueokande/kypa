import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { collectReferences } from './references.js';

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../rules/fixtures/${name}.yml`, import.meta.url),
    'utf8',
  );
test('collects step and reusable workflow references with commit-pinned locations', () => {
  const refs = collectReferences(
    fixture('workflow'),
    '.github/workflows/ci.yml',
    'org/repo',
    'a'.repeat(40),
  );
  expect(refs.map((item) => item.reference)).toEqual([
    'actions/checkout@v4',
    `company/check@${'0123456789abcdef0123456789abcdef01234567'}`,
    'company/workflows/.github/workflows/check.yml@main',
  ]);
  expect(refs[0]?.line).toBe(7);
  expect(refs[0]?.url).toContain(
    `/blob/${'a'.repeat(40)}/.github/workflows/ci.yml#L7`,
  );
});
test('collects composite references but not JavaScript Action manifests', () => {
  expect(
    collectReferences(
      fixture('composite'),
      'action.yaml',
      'org/repo',
      'a'.repeat(40),
    ),
  ).toHaveLength(1);
  expect(
    collectReferences(
      'runs:\n  using: node24\n  main: index.js\n',
      'action.yml',
      'org/repo',
      'a'.repeat(40),
    ),
  ).toEqual([]);
});
test.each([
  'jobs: [',
  'jobs:\n  a:\n    uses: nope\n',
  'jobs:\n  a:\n    steps:\n      - uses: 42\n',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression fixture, not JavaScript interpolation.
  'jobs:\n  a:\n    uses: ${{ inputs.action }}\n',
])(
  'parse failures and unsupported references cannot silently pass',
  (source) => {
    expect(() =>
      collectReferences(
        source,
        '.github/workflows/ci.yml',
        'org/repo',
        'a'.repeat(40),
      ),
    ).toThrow();
  },
);
