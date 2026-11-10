import { expect, test, vi } from 'vitest';
import { GitHubClient } from './client.js';

const settings = {
  token: 'private-token',
  concurrency: 2,
  retries: 2,
  requestTimeoutSeconds: 30,
};
test('honors Retry-After and never includes credentials in the URL', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'retry-after': '2' } }),
    )
    .mockResolvedValueOnce(Response.json({ ok: true }));
  const sleep = vi.fn(async () => {});
  expect(
    await new GitHubClient({ ...settings, fetch: transport, sleep }).get(
      '/user',
    ),
  ).toEqual({ ok: true });
  expect(sleep).toHaveBeenCalledWith(2000, undefined);
  expect(transport.mock.calls[0]?.[0]).toBe('https://api.github.com/user');
});
test('401 is fatal; 404 is not retried and cannot expose response text', async () => {
  const unauthorized = new GitHubClient({
    ...settings,
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('token private-token', { status: 401 })),
  });
  await expect(unauthorized.get('/user')).rejects.toThrow('authentication');
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('secret payload', { status: 404 }));
  await expect(
    new GitHubClient({ ...settings, fetch: transport }).get('/x'),
  ).rejects.toThrow('GitHub request failed');
  expect(transport).toHaveBeenCalledTimes(1);
});
test('bounds retries, cancellation, and excessively long server delays', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response('', { status: 503 }));
  await expect(
    new GitHubClient({
      ...settings,
      fetch: transport,
      sleep: async () => {},
    }).get('/x'),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(3);
  await expect(
    new GitHubClient(settings).get('/x', AbortSignal.abort()),
  ).rejects.toThrow();
  await expect(
    new GitHubClient({
      ...settings,
      fetch: async () =>
        new Response('', { status: 429, headers: { 'retry-after': '999999' } }),
    }).get('/x'),
  ).rejects.toThrow();
});
test('request concurrency stays within the configured limit', async () => {
  let active = 0;
  let maximum = 0;
  const client = new GitHubClient({
    ...settings,
    fetch: async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return Response.json({});
    },
  });
  await Promise.all(Array.from({ length: 10 }, () => client.get('/x')));
  expect(maximum).toBe(2);
});

test('queued requests cancel without waiting for an occupied request slot', async () => {
  let release: (() => void) | undefined;
  const client = new GitHubClient({
    ...settings,
    concurrency: 1,
    fetch: async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Response.json({});
    },
  });
  const first = client.get('/first');
  await vi.waitFor(() => expect(release).toBeDefined());
  const controller = new AbortController();
  const second = client.get('/second', controller.signal);
  controller.abort();
  await expect(second).rejects.toThrow();
  release?.();
  await first;
});
