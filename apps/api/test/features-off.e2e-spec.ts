import './features-off.setup';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { auth, createApp, registerStaff } from './helpers';

describe('Funcionalidades extra desligadas (e2e)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('as rotas públicas respondem 404 e /features indica tudo desligado', async () => {
    const http = app.getHttpServer();
    const f = await request(http).get('/api/v1/features').expect(200);
    expect(Object.values(f.body).every((v) => v === false)).toBe(true);
    for (const path of ['/api/v1/blog/posts', '/api/v1/site/content/about', '/api/v1/testimonials', '/api/v1/status']) {
      await request(http).get(path).expect(404);
    }
  });

  it('as rotas autenticadas também respondem 404', async () => {
    const s = await registerStaff(app);
    await request(app.getHttpServer()).get('/api/v1/marketplace/listings').set(auth(s.token)).expect(404);
  });
});
