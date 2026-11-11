import type { Evidence, Resource } from '@kypa/sdk';
import { expect, test } from 'vitest';
import { fullSha, requiredReviews } from './index.js';

const resource: Resource = {
  provider: 'github',
  type: 'repository',
  id: '1',
  name: 'org/repo',
  url: 'https://github.com/org/repo',
  metadata: {},
};

const available = (data: unknown): Evidence => ({
  state: 'available',
  observedAt: '2026-01-01T00:00:00Z',
  data,
});

const references = (refs: string[]) => ({
  'github/action-references@1': available({
    references: refs.map((reference) => ({
      reference,
      path: '.github/workflows/ci.yml',
      line: 1,
      url: 'https://github.com/org/repo/blob/abc/file#L1',
    })),
  }),
});

test('full-SHA violations are independent of target suppression comments', () => {
  const result = fullSha.evaluate(
    resource,
    references(['actions/checkout@v4', `org/action@${'a'.repeat(40)}`]),
    {},
  );
  expect(result.applicable).toBe(true);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.location?.line).toBe(1);
});
test('no remote references is not applicable', () => {
  expect(fullSha.evaluate(resource, references([]), {}).applicable).toBe(false);
});
test('malformed or unavailable evidence cannot pass', () => {
  expect(() =>
    fullSha.evaluate(
      resource,
      { 'github/action-references@1': available({}) },
      {},
    ),
  ).toThrow();
  expect(() => fullSha.evaluate(resource, {}, {})).toThrow();
});
test.each([0, 1, 2, 6])(
  'required reviews evaluates established minimum %i',
  (minimum) => {
    const result = requiredReviews.evaluate(
      resource,
      { 'github/classic-protection@1': available({ minimum }) },
      { minimum: 2 },
    );
    expect(result.findings.length).toBe(minimum < 2 ? 1 : 0);
  },
);
test('empty repository is not applicable, invalid limits are rejected', () => {
  expect(
    requiredReviews.evaluate(
      resource,
      {
        'github/classic-protection@1': {
          state: 'not-applicable',
          observedAt: '',
        },
      },
      { minimum: 1 },
    ).applicable,
  ).toBe(false);
  expect(requiredReviews.validateParameters({})).toEqual({ minimum: 1 });
  for (const minimum of [0, 7, 1.5, '2'])
    expect(() => requiredReviews.validateParameters({ minimum })).toThrow();
});
