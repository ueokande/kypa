import type { Report } from '@kypa/sdk';
import './style.css';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
function select(label: string, values: string[]): HTMLSelectElement {
  const container = element('label', label);
  const control = element('select');
  for (const value of ['', ...values]) {
    const option = element('option', value || 'All');
    option.value = value;
    control.append(option);
  }
  container.append(control);
  document.querySelector('#filters')?.append(container);
  return control;
}
export function renderReport(report: Report): void {
  if (report.schemaVersion !== 1) throw new Error('Unsupported report format.');
  const main = element('main');
  document.body.replaceChildren(main);
  main.append(
    element('h1', 'Kypa'),
    element('p', 'Keep Your Policies Aligned'),
  );
  const freshness = element('section');
  freshness.append(
    element('h2', `${report.run.status.toUpperCase()} scan`),
    element('p', `Scanned ${report.run.completedAt} · Run ${report.run.id}`),
  );
  const age = Math.max(
    0,
    (Date.now() - Date.parse(report.run.completedAt)) / 3_600_000,
  );
  freshness.append(
    element(
      'p',
      `Result age: ${Math.floor(age)} hours. Check the workflow if a newer scan was expected.`,
    ),
  );
  main.append(freshness);
  main.append(
    element(
      'p',
      `${report.scope.discovered} resources · ${report.scope.evaluated} processed · ${report.findings.length} violations · ${report.errors.length} errors`,
    ),
  );
  main.append(
    element(
      'p',
      'Discovery is limited to accessible repositories. API settings and file evidence are not an atomic snapshot.',
    ),
  );
  if (report.run.status === 'partial')
    main.append(
      element(
        'strong',
        'Missing coverage: this report cannot establish compliance for all intended targets.',
      ),
    );
  if (report.errors.length) {
    const errors = element('section');
    errors.append(element('h2', 'Coverage errors'));
    for (const error of report.errors)
      errors.append(
        element(
          'p',
          `${error.phase}: ${error.resource ?? 'discovery'} ${error.rule ?? ''} — ${error.message}`,
        ),
      );
    main.append(errors);
  }
  const filters = element('section');
  filters.id = 'filters';
  main.append(filters);
  const searchLabel = element('label', 'Search');
  const search = element('input');
  search.type = 'search';
  searchLabel.append(search);
  filters.append(searchLabel);
  const resource = select('Resource', [
    ...new Set(report.resources.map((item) => item.name)),
  ]);
  const rule = select('Rule', [
    ...new Set(report.evaluations.map((item) => item.rule)),
  ]);
  const severity = select('Severity', [
    'info',
    'low',
    'medium',
    'high',
    'critical',
  ]);
  const results = element('section');
  main.append(results);
  const names = new Map(
    report.resources.map((item) => [
      `${item.provider}/${item.type}/${item.id}`,
      item.name,
    ]),
  );
  const update = () => {
    results.replaceChildren(element('h2', 'Evaluations'));
    const selected = report.evaluations.filter((item) => {
      const name = names.get(item.resource) ?? item.resource;
      return (
        (!resource.value || resource.value === name) &&
        (!rule.value || rule.value === item.rule) &&
        (!severity.value || severity.value === item.severity) &&
        `${name} ${item.rule} ${item.status}`
          .toLowerCase()
          .includes(search.value.toLowerCase())
      );
    });
    results.append(element('p', `${selected.length} matching evaluations`));
    const findings = new Map(
      report.findings.map((finding) => [finding.id, finding]),
    );
    for (const evaluation of selected) {
      const card = element('article');
      card.append(
        element(
          'h3',
          `${names.get(evaluation.resource) ?? evaluation.resource} · ${evaluation.rule}`,
        ),
        element('p', `${evaluation.status} · ${evaluation.severity}`),
      );
      for (const id of evaluation.findingIds) {
        const finding = findings.get(id);
        if (!finding) continue;
        card.append(
          element('p', finding.message),
          element('p', finding.remediation),
        );
        if (finding.location) {
          const link = element(
            'a',
            `${finding.location.path}:${finding.location.line}`,
          );
          if (finding.location.url?.startsWith('https://github.com/')) {
            link.href = finding.location.url;
            link.rel = 'noreferrer';
          }
          card.append(link);
        }
      }
      results.append(card);
    }
  };
  for (const control of [search, resource, rule, severity])
    control.addEventListener('input', update);
  update();
}
if (typeof document !== 'undefined') {
  fetch(new URL('data.json', document.baseURI))
    .then((response) => {
      if (!response.ok) throw new Error('Report unavailable.');
      return response.json() as Promise<Report>;
    })
    .then(renderReport)
    .catch(() => {
      document.body.replaceChildren(
        element(
          'p',
          'The scan report could not be loaded. Check deployment artifacts and basePath.',
        ),
      );
    });
}
