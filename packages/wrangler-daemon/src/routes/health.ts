import type { FastifyInstance } from 'fastify';

/** Health check route */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/health', async () => {
    return { status: 'ok' };
  });
}
