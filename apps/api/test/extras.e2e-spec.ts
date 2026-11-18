import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { auth, createApp, registerStaff, type StaffSession } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { MarketplaceService } from '../src/modules/extras/marketplace.service';

describe('Funcionalidades extra (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;
  let prisma: PrismaService;
  let admin: string; // token de SUPER_ADMIN
  let user: StaffSession;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    const a = await registerStaff(app);
    await prisma.user.update({ where: { id: a.userId }, data: { platformRole: 'SUPER_ADMIN' } });
    admin = (await request(http).post('/api/v1/auth/login').send({ email: a.email, password: 'Segredo123' }).expect(200)).body.accessToken;
    user = await registerStaff(app);
  });
  afterAll(() => app.close());

  describe('Blog', () => {
    it('rascunhos não são públicos; publicar torna o artigo visível', async () => {
      const cat = await request(http).post('/api/v1/admin/blog/categories').set(auth(admin)).send({ name: 'Dicas para senhorios' }).expect(201);
      expect(cat.body.slug).toBe('dicas-para-senhorios');

      const post = await request(http)
        .post('/api/v1/admin/blog/posts')
        .set(auth(admin))
        .send({
          title: 'Como evitar atrasos na renda',
          excerpt: 'Cinco práticas simples que reduzem os atrasos.',
          content: 'Texto do artigo com algumas palavras para calcular o tempo de leitura. '.repeat(40),
          categoryId: cat.body.id,
        })
        .expect(201);
      expect(post.body).toMatchObject({ status: 'DRAFT', slug: 'como-evitar-atrasos-na-renda', readTimeMinutes: 2 });

      await request(http).get('/api/v1/blog/posts/como-evitar-atrasos-na-renda').expect(404);
      await request(http).patch(`/api/v1/admin/blog/posts/${post.body.id}`).set(auth(admin)).send({ status: 'PUBLISHED' }).expect(200);
      const pub = await request(http).get('/api/v1/blog/posts/como-evitar-atrasos-na-renda').expect(200);
      expect(pub.body.category.slug).toBe('dicas-para-senhorios');
      const list = await request(http).get('/api/v1/blog/posts?category=dicas-para-senhorios').expect(200);
      expect(list.body.data).toHaveLength(1);
    });

    it('slug duplicado dá conflito; só administradores escrevem', async () => {
      const body = { title: 'Como evitar atrasos na renda', excerpt: 'Outro resumo com texto.', content: 'x'.repeat(30) };
      const dup = await request(http).post('/api/v1/admin/blog/posts').set(auth(admin)).send(body).expect(409);
      expect(dup.body.error.code).toBe('SLUG_TAKEN');
      await request(http).post('/api/v1/admin/blog/posts').set(auth(user.token)).send(body).expect(403);
      await request(http).get('/api/v1/admin/blog/posts').expect(401);
    });
  });

  describe('Conteúdo do site e contacto', () => {
    it('devolve conteúdo por omissão; administração edita com validação', async () => {
      const def = await request(http).get('/api/v1/site/content/about').expect(200);
      expect(def.body.data.title).toBe('Sobre o Rentix');
      await request(http).get('/api/v1/site/content/inexistente').expect(422);

      await request(http).put('/api/v1/admin/site/content/contact').set(auth(admin)).send({ items: [{ type: 'fax', label: 'x', value: 'y' }] }).expect(422);
      await request(http)
        .put('/api/v1/admin/site/content/contact')
        .set(auth(admin))
        .send({ intro: 'Fale connosco', items: [{ type: 'whatsapp', label: 'WhatsApp', value: '+258 84 000 0000' }] })
        .expect(200);
      const c = await request(http).get('/api/v1/site/content/contact').expect(200);
      expect(c.body.data.items[0].type).toBe('whatsapp');
    });

    it('formulário de contacto grava a mensagem e avisa a caixa geral; robots são ignorados', async () => {
      await request(http)
        .post('/api/v1/site/contact')
        .send({ name: 'Maria', email: 'maria@teste.co.mz', subject: 'Demonstração', message: 'Gostaria de ver uma demonstração.' })
        .expect(201);
      await request(http)
        .post('/api/v1/site/contact')
        .send({ name: 'Robot', email: 'bot@spam.com', subject: 'Compre já', message: 'Texto de spam qualquer.', website: '' })
        .expect(201);
      const before = await prisma.contactMessage.count();
      await request(http)
        .post('/api/v1/site/contact')
        .send({ name: 'Robot', email: 'bot@spam.com', subject: 'Compre já', message: 'Texto de spam qualquer.', website: 'http://spam' })
        .expect(422);
      expect(await prisma.contactMessage.count()).toBe(before);

      const msgs = await request(http).get('/api/v1/admin/site/messages?status=NEW').set(auth(admin)).expect(200);
      expect(msgs.body.data.some((m: { name: string }) => m.name === 'Maria')).toBe(true);
      expect(await prisma.notification.count({ where: { template: 'CONTACT_MESSAGE', recipient: 'geral@teste.co.mz' } })).toBeGreaterThan(0);
    });
  });

  describe('Testemunhos', () => {
    it('só aparecem depois de aprovados; editar volta a revisão', async () => {
      const t = await request(http)
        .put('/api/v1/testimonials/mine')
        .set(auth(user.token))
        .send({ name: 'João Sitoe', role: 'Senhorio', city: 'Matola', rating: 5, message: 'Deixei de andar atrás dos inquilinos para cobrar a renda.' })
        .expect(200);
      expect((await request(http).get('/api/v1/testimonials').expect(200)).body).toHaveLength(0);

      await request(http).patch(`/api/v1/admin/testimonials/${t.body.id}`).set(auth(admin)).send({ status: 'APPROVED' }).expect(200);
      expect((await request(http).get('/api/v1/testimonials').expect(200)).body).toHaveLength(1);

      await request(http)
        .put('/api/v1/testimonials/mine')
        .set(auth(user.token))
        .send({ name: 'João Sitoe', rating: 4, message: 'Continua ótimo, mas gostava de relatórios mensais.' })
        .expect(200);
      expect((await request(http).get('/api/v1/testimonials').expect(200)).body).toHaveLength(0);
    });
  });

  describe('Estado do sistema', () => {
    it('incidente degrada os componentes e resolvê-lo repõe-nos', async () => {
      const api = await request(http).post('/api/v1/admin/status/components').set(auth(admin)).send({ name: 'API', sortOrder: 1 }).expect(201);
      await request(http).post('/api/v1/admin/status/components').set(auth(admin)).send({ name: 'Pagamentos M-Pesa', sortOrder: 2 }).expect(201);
      expect((await request(http).get('/api/v1/status').expect(200)).body.overall).toBe('OPERATIONAL');

      const inc = await request(http)
        .post('/api/v1/admin/status/incidents')
        .set(auth(admin))
        .send({ title: 'Lentidão na API', impact: 'MINOR', message: 'Estamos a investigar.', componentIds: [api.body.id], componentStatus: 'DEGRADED' })
        .expect(201);
      let status = (await request(http).get('/api/v1/status').expect(200)).body;
      expect(status.overall).toBe('DEGRADED');
      expect(status.activeIncidents).toHaveLength(1);

      await request(http).post(`/api/v1/admin/status/incidents/${inc.body.id}/updates`).set(auth(admin)).send({ status: 'RESOLVED', message: 'Resolvido.' }).expect(201);
      status = (await request(http).get('/api/v1/status').expect(200)).body;
      expect(status.overall).toBe('OPERATIONAL');
      expect(status.recentIncidents[0].updates).toHaveLength(2);
      await request(http).post(`/api/v1/admin/status/incidents/${inc.body.id}/updates`).set(auth(admin)).send({ status: 'MONITORING', message: 'x x x' }).expect(409);
    });
  });

  describe('Marketplace', () => {
    const listing = {
      title: 'Apartamento T3 na Sommerschield',
      description: 'Apartamento mobilado, 3 quartos, com parqueamento e gerador.',
      purpose: 'RENT',
      propertyType: 'APARTMENT',
      price: 6_000_000,
      city: 'Maputo',
      neighbourhood: 'Sommerschield',
      bedrooms: 3,
    };

    it('anúncio passa por revisão; interesse revela contactos só depois de aceite', async () => {
      const seller = await registerStaff(app);
      const buyer = await registerStaff(app);

      const created = await request(http).post('/api/v1/marketplace/my-listings').set(auth(seller.token)).send(listing).expect(201);
      expect(created.body.status).toBe('PENDING_REVIEW');
      // Pendente: invisível para os outros.
      await request(http).get(`/api/v1/marketplace/listings/${created.body.id}`).set(auth(buyer.token)).expect(404);

      const queue = await request(http).get('/api/v1/admin/marketplace/listings').set(auth(admin)).expect(200);
      expect(queue.body.data.some((l: { id: string }) => l.id === created.body.id)).toBe(true);
      await request(http).post(`/api/v1/admin/marketplace/listings/${created.body.id}/moderate`).set(auth(admin)).send({ decision: 'REJECT' }).expect(422);
      await request(http).post(`/api/v1/admin/marketplace/listings/${created.body.id}/moderate`).set(auth(admin)).send({ decision: 'APPROVE' }).expect(200);
      expect(await prisma.notification.count({ where: { template: 'LISTING_REVIEWED', recipient: seller.email } })).toBe(1);

      const browse = await request(http).get('/api/v1/marketplace/listings?city=maputo').set(auth(buyer.token)).expect(200);
      expect(browse.body.data.find((l: { id: string }) => l.id === created.body.id)).toMatchObject({ isMine: false, myInterest: null });

      // Ver duas vezes conta uma visualização.
      await request(http).get(`/api/v1/marketplace/listings/${created.body.id}`).set(auth(buyer.token)).expect(200);
      const detail = await request(http).get(`/api/v1/marketplace/listings/${created.body.id}`).set(auth(buyer.token)).expect(200);
      expect(detail.body.viewsCount).toBe(1);
      expect(detail.body.contact).toBeNull();

      // Não pode mostrar interesse no próprio anúncio.
      await request(http).post(`/api/v1/marketplace/listings/${created.body.id}/interests`).set(auth(seller.token)).send({}).expect(403);

      await request(http).post(`/api/v1/marketplace/listings/${created.body.id}/interests`).set(auth(buyer.token)).send({ message: 'Tenho um cliente.' }).expect(201);
      await request(http).post(`/api/v1/marketplace/listings/${created.body.id}/interests`).set(auth(buyer.token)).send({}).expect(409);
      expect(await prisma.notification.count({ where: { template: 'LISTING_INTEREST', recipient: seller.email } })).toBe(1);

      const interests = await request(http).get(`/api/v1/marketplace/my-listings/${created.body.id}/interests`).set(auth(seller.token)).expect(200);
      expect(interests.body[0].contact).toBeNull();
      await request(http)
        .patch(`/api/v1/marketplace/my-listings/${created.body.id}/interests/${interests.body[0].id}`)
        .set(auth(seller.token))
        .send({ status: 'ACCEPTED' })
        .expect(200);

      const after = await request(http).get(`/api/v1/marketplace/listings/${created.body.id}`).set(auth(buyer.token)).expect(200);
      expect(after.body.contact.email).toBe(seller.email);
      const sellerView = await request(http).get(`/api/v1/marketplace/my-listings/${created.body.id}/interests`).set(auth(seller.token)).expect(200);
      expect(sellerView.body[0].contact.email).toBe(buyer.email);

      // Outra organização não vê nem gere os interesses.
      await request(http).get(`/api/v1/marketplace/my-listings/${created.body.id}/interests`).set(auth(buyer.token)).expect(404);
    });

    it('editar volta a revisão; denúncia confirmada fecha o anúncio', async () => {
      const seller = await registerStaff(app);
      const other = await registerStaff(app);
      const l = await request(http).post('/api/v1/marketplace/my-listings').set(auth(seller.token)).send(listing).expect(201);
      await request(http).post(`/api/v1/admin/marketplace/listings/${l.body.id}/moderate`).set(auth(admin)).send({ decision: 'APPROVE' }).expect(200);

      const r = await request(http).post(`/api/v1/marketplace/listings/${l.body.id}/reports`).set(auth(other.token)).send({ reason: 'FALSE_INFO', description: 'Já foi arrendado.' }).expect(201);
      await request(http).post(`/api/v1/marketplace/listings/${l.body.id}/reports`).set(auth(other.token)).send({ reason: 'SPAM' }).expect(409);
      await request(http).patch(`/api/v1/admin/marketplace/reports/${r.body.id}`).set(auth(admin)).send({ status: 'REVIEWED', closeListing: true }).expect(200);
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: l.body.id } })).status).toBe('CLOSED');

      const l2 = await request(http).post('/api/v1/marketplace/my-listings').set(auth(seller.token)).send(listing).expect(201);
      await request(http).post(`/api/v1/admin/marketplace/listings/${l2.body.id}/moderate`).set(auth(admin)).send({ decision: 'APPROVE' }).expect(200);
      const edited = await request(http).patch(`/api/v1/marketplace/my-listings/${l2.body.id}`).set(auth(seller.token)).send({ price: 5_500_000 }).expect(200);
      expect(edited.body.status).toBe('PENDING_REVIEW');
    });

    it('anúncios expiram e podem ser renovados', async () => {
      const seller = await registerStaff(app);
      const l = await request(http).post('/api/v1/marketplace/my-listings').set(auth(seller.token)).send({ ...listing, durationDays: 7 }).expect(201);
      await request(http).post(`/api/v1/admin/marketplace/listings/${l.body.id}/moderate`).set(auth(admin)).send({ decision: 'APPROVE' }).expect(200);
      await app.get(MarketplaceService).expire(new Date(Date.now() + 8 * 86_400_000));
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: l.body.id } })).status).toBe('EXPIRED');
      const renewed = await request(http).post(`/api/v1/marketplace/my-listings/${l.body.id}/renew`).set(auth(seller.token)).expect(200);
      expect(renewed.body.status).toBe('ACTIVE');
    });
  });
});
