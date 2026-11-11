import type { Evidence, Rule } from '@kypa/sdk';
import { z } from 'zod';

const actionReferences = z.object({
  references: z.array(
    z.object({
      reference: z.string(),
      path: z.string(),
      line: z.number().int().positive(),
      url: z.string().url(),
    }),
  ),
});
const protection = z.object({ minimum: z.number().int().nonnegative() });
export const fullSha: Rule = {
  id: 'actions/full-sha',
  version: '1.0.0',
  resourceTypes: ['github/repository'],
  requiredEvidence: ['github/action-references@1'],
  defaultSeverity: 'high',
  validateParameters: (input) => z.object({}).strict().parse(input),

  evaluate(_resource, evidence) {
    const item = evidence['github/action-references@1'];
    if (item?.state === 'not-applicable') {
      return { applicable: false, findings: [] };
    }
    if (item?.state !== 'available') {
      throw new Error('Unavailable evidence.');
    }
    const data = actionReferences.parse(item.data);
    return {
      applicable: data.references.length > 0,
      findings: data.references
        .filter((ref) => !/@[a-fA-F0-9]{40}$/.test(ref.reference))
        .map((ref) => ({
          key: JSON.stringify([ref.path, ref.line, ref.reference]),
          message:
            'Remote Action or reusable workflow reference is not pinned to a full commit SHA.',
          remediation:
            'Replace the reference with a reviewed 40-character commit SHA.',
          location: { path: ref.path, line: ref.line, url: ref.url },
        })),
    };
  },
};
export const requiredReviews: Rule = {
  id: 'repository/required-reviews',
  version: '1.0.0',
  resourceTypes: ['github/repository'],
  requiredEvidence: ['github/classic-protection@1'],
  defaultSeverity: 'medium',
  validateParameters: (input) =>
    z
      .object({ minimum: z.number().int().min(1).max(6).default(1) })
      .strict()
      .parse(input),

  evaluate(_resource, evidence, input) {
    const item: Evidence | undefined = evidence['github/classic-protection@1'];
    if (item?.state === 'not-applicable') {
      return { applicable: false, findings: [] };
    }
    if (item?.state !== 'available') {
      throw new Error('Unavailable evidence.');
    }
    const actual = protection.parse(item.data);
    const parameters = z.object({ minimum: z.number() }).parse(input);
    return {
      applicable: true,
      findings:
        actual.minimum < parameters.minimum
          ? [
              {
                key: 'default-branch-reviews',
                message: `Classic default-branch protection requires fewer than ${parameters.minimum} approving reviews.`,
                remediation:
                  'Configure the required number of reviews in classic default-branch protection, or deselect this check if rulesets are your policy mechanism.',
              },
            ]
          : [],
    };
  },
};
export const builtInRules: readonly Rule[] = [fullSha, requiredReviews];
