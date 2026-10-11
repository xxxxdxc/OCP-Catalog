import { afterEach, describe, expect, it } from 'bun:test';
import { OcpClient, OcpClientError } from './index';
import type { OcpActivityEventInput } from '@ocp-catalog/ocp-activity-schema';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const url = 'https://catalog.example.test/ocp/manifest';

async function captureError(client: OcpClient): Promise<OcpClientError> {
  try {
    await client.inspectCatalog(url);
  } catch (error) {
    expect(error).toBeInstanceOf(OcpClientError);
    return error as OcpClientError;
  }
  throw new Error('Expected the request to fail');
}

describe('OcpClient HTTP error responses', () => {
  for (const item of [
    { name: 'JSON', status: 503, body: '{"error":{"code":"temporarily_unavailable"}}', payload: { error: { code: 'temporarily_unavailable' } } },
    { name: 'HTML', status: 503, body: '<html>Service Unavailable</html>', payload: '<html>Service Unavailable</html>' },
    { name: 'plain text', status: 502, body: 'Bad Gateway', payload: 'Bad Gateway' },
    { name: 'empty', status: 401, body: '', payload: null },
  ]) {
    it(`preserves HTTP status and classification for ${item.name} errors`, async () => {
      const events: OcpActivityEventInput[] = [];
      globalThis.fetch = (async () => new Response(item.body, { status: item.status })) as typeof fetch;
      const error = await captureError(new OcpClient({ activity: { sink: event => { events.push(event); } } }));
      expect(error.message).toBe(`HTTP ${item.status} from ${url}`);
      expect(error.details).toMatchObject({ url, status: item.status, payload: item.payload });
      expect(events.find(event => event.event_type === 'client.call_completed')).toMatchObject({
        status_code: item.status, error_code: 'http_error',
      });
    });
  }

  it('bounds non-JSON error body diagnostics', async () => {
    globalThis.fetch = (async () => new Response('x'.repeat(3000), { status: 502 })) as typeof fetch;
    const error = await captureError(new OcpClient());
    expect(error.details.status).toBe(502);
    expect(error.details.payload).toBe('x'.repeat(2000));
  });

  it('preserves successful HTTP status when JSON parsing fails', async () => {
    const events: OcpActivityEventInput[] = [];
    globalThis.fetch = (async () => new Response('<html>Wrong upstream</html>', { status: 200 })) as typeof fetch;
    const error = await captureError(new OcpClient({ activity: { sink: event => { events.push(event); } } }));
    expect(error.message).toBe(`Invalid JSON response from ${url}`);
    expect(error.details.status).toBe(200);
    expect(error.details.cause).toBeString();
    expect(events.find(event => event.event_type === 'client.call_completed')).toMatchObject({
      status_code: 200, error_code: 'invalid_json',
    });
  });

  it('keeps network failures distinct from HTTP responses', async () => {
    const events: OcpActivityEventInput[] = [];
    globalThis.fetch = (async () => { throw new TypeError('Connection failed'); }) as typeof fetch;
    const error = await captureError(new OcpClient({ activity: { sink: event => { events.push(event); } } }));
    expect(error.message).toBe(`Failed to fetch ${url}`);
    expect(error.details.status).toBeUndefined();
    expect(error.details.cause).toBe('Connection failed');
    expect(events.find(event => event.event_type === 'client.call_completed')?.error_code).toBe('fetch_error');
  });

  it('keeps timeouts distinct from HTTP responses', async () => {
    const events: OcpActivityEventInput[] = [];
    globalThis.fetch = (async () => { throw new DOMException('Request aborted', 'AbortError'); }) as typeof fetch;
    const error = await captureError(new OcpClient({ activity: { sink: event => { events.push(event); } } }));
    expect(error.details.status).toBeUndefined();
    expect(events.find(event => event.event_type === 'client.call_completed')?.error_code).toBe('timeout');
  });
});
