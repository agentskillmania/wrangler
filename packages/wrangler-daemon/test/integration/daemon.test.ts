import { describe, it, expect, afterEach } from 'vitest';
import { Daemon } from '../../src/daemon.js';

describe('Daemon', () => {
  let daemon: Daemon | null = null;

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
  });

  it('startup listens on the specified port', async () => {
    daemon = new Daemon({ port: 0 }); // port 0 = random available port
    await daemon.startup();

    expect(daemon.address).toBeTruthy();
    expect(daemon.address).toMatch(/:\d+$/);
  });

  it('shutdown stops the server', async () => {
    daemon = new Daemon({ port: 0 });
    await daemon.startup();
    const addr = daemon.address;

    await daemon.shutdown();
    daemon = null;

    // Fetching the shutdown server should fail with connection error
    await expect(fetch(`http://${addr}/api/health`)).rejects.toThrow();
  });

  it('health endpoint returns ok', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const response = await fetch(`http://${daemon.address}/api/health`);
    expect(response.ok).toBe(true);

    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  it('throws when accessing address before startup', async () => {
    daemon = new Daemon({ port: 0 });
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      daemon.address;
    }).toThrow('Daemon not started');
  });

  it('uses default options when none provided', async () => {
    daemon = new Daemon();
    await daemon.startup();

    expect(daemon.address).toContain('3100');
    expect(daemon.address).toMatch(/:\d+$/);
  });

  it('uses custom host when provided', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    expect(daemon.address).toContain('127.0.0.1');
  });

  it('address handles both string and object address types', async () => {
    daemon = new Daemon({ port: 0 });
    await daemon.startup();

    // The address should be in the format "address:port" (object type)
    expect(daemon.address).toMatch(/:\d+$/);
  });

  it('root endpoint serves playground page', async () => {
    daemon = new Daemon({ port: 0 });
    await daemon.startup();

    const addr = daemon.address;
    // Address may be "host:port" or "::1:port" — split last segment as port
    const addrStr =
      typeof addr === 'string' ? addr : `${(addr as any).address}:${(addr as any).port}`;
    const lastColon = addrStr.lastIndexOf(':');
    const hostPart = addrStr.slice(0, lastColon);
    const portPart = addrStr.slice(lastColon + 1);
    const url = hostPart.includes(':')
      ? `http://[${hostPart}]:${portPart}/`
      : `http://${hostPart}:${portPart}/`;
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/html');

    const html = await response.text();
    expect(html).toContain('Wrangler Daemon Playground');
  });
});
