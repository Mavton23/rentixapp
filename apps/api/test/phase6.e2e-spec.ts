import type { NestExpressApplication } from '@nestjs/platform-express';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import request from 'supertest';
import { periodOf, todayIn } from '@rentix/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, createPropertyWithUnit, createTenant, registerStaff, type StaffSession } from './helpers';

/** Corpo binário (PDF, Excel, imagens). */
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Relatórios, ficheiros e contratos (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;
  let prisma: PrismaService;
  let owner: StaffSession;
  let leaseId: string;
  let tenantId: string;
  let propertyId: string;
  const today = todayIn('Africa/Maputo');

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    owner = await registerStaff(app, { organizationName: 'Imóveis Relatório' });
    const u = await createPropertyWithUnit(app, owner.token);
    propertyId = u.propertyId;
    tenantId = await createTenant(app, owner.token, { fullName: 'Ana Maria Sitoe', nuit: '100234567', maritalStatus: 'SINGLE', occupation: 'enfermeira' });
    const lease = await request(http)
      .post('/api/v1/leases')
      .set(auth(owner.token))
      .send({ unitId: u.unitId, tenantId, startDate: `${periodOf(today)}-01`, endDate: null, rentAmount: 2_500_000, depositAmount: 5_000_000, billingDay: 5 })
      .expect(201);
    leaseId = lease.body.id;
    const invoices = (await request(http).get(`/api/v1/invoices?leaseId=${leaseId}&pageSize=50`).set(auth(owner.token)).expect(200)).body.data as { id: string; kind: string }[];
    const rent = invoices.find((i) => i.kind === 'RENT')!;
    await request(http).post('/api/v1/payments').set(auth(owner.token)).send({ invoiceId: rent.id, amount: 1_000_000, method: 'MPESA', paidAt: today, reference: 'MP1' }).expect(201);
  });
  afterAll(() => app.close());

  describe('Relatórios', () => {
    it('resumo do período: faturado, cobrado, dívida, por imóvel e 12 meses', async () => {
      const r = await request(http).get('/api/v1/reports/summary').set(auth(owner.token)).expect(200);
      const mzn = (list: { currency: string; amount: number }[]) => list.find((x) => x.currency === 'MZN')?.amount;
      expect(mzn(r.body.billed.total)).toBe(7_500_000); // renda + caução
      expect(mzn(r.body.collected.total)).toBe(1_000_000);
      expect(r.body.collected.byMethod[0]).toMatchObject({ method: 'MPESA', amount: 1_000_000, count: 1 });
      expect(mzn(r.body.outstanding.total)).toBe(6_500_000);
      expect(r.body.monthly).toHaveLength(12);
      expect(r.body.monthly[11]).toMatchObject({ period: periodOf(today), billed: 7_500_000, collected: 1_000_000 });
      expect(r.body.byProperty).toEqual([expect.objectContaining({ id: propertyId, units: 1, occupied: 1, collected: 1_000_000 })]);
    });

    it('intervalo inválido é recusado', async () => {
      const r = await request(http).get('/api/v1/reports/summary').query({ from: '2026-12-01', to: '2026-01-01' }).set(auth(owner.token)).expect(422);
      expect(r.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('antiguidade das dívidas por inquilino', async () => {
      const r = await request(http).get('/api/v1/reports/aging').set(auth(owner.token)).expect(200);
      expect(r.body.rows).toHaveLength(1);
      expect(r.body.rows[0]).toMatchObject({ tenant: { fullName: 'Ana Maria Sitoe' }, total: 6_500_000 });
    });

    it('exportação Excel: números como números, totais e registo na auditoria', async () => {
      const res = await request(http).get('/api/v1/reports/export/invoices').set(auth(owner.token)).buffer(true).parse(binary).expect(200);
      expect(res.headers['content-disposition']).toMatch(/faturas-.*\.xlsx/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as never);
      const ws = wb.getWorksheet('Faturas')!;
      expect(ws.getRow(1).getCell(1).value).toBe('Número');
      expect(ws.rowCount).toBe(4); // cabeçalho + 2 faturas + total
      const amounts = [2, 3].map((r) => ws.getRow(r).getCell(12).value).sort();
      expect(amounts).toEqual([25000, 50000]);
      expect(wb.getWorksheet('Informação')!.getRow(1).getCell(2).value).toBe('Imóveis Relatório');
      for (const kind of ['payments', 'tenants', 'aging']) {
        await request(http).get(`/api/v1/reports/export/${kind}`).set(auth(owner.token)).buffer(true).parse(binary).expect(200);
      }
      await request(http).get('/api/v1/reports/export/segredos').set(auth(owner.token)).expect(400);
      expect(await prisma.auditLog.count({ where: { organizationId: owner.organizationId, action: 'report.exported' } })).toBe(4);
    });

    it('outra organização não vê nada', async () => {
      const other = await registerStaff(app);
      const r = await request(http).get('/api/v1/reports/summary').set(auth(other.token)).expect(200);
      expect(r.body.billed.total).toEqual([]);
      expect(r.body.byProperty).toEqual([]);
    });
  });

  describe('Ficheiros', () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

    it('envia um PDF para o inquilino, lista, descarrega e partilha no portal', async () => {
      const up = await request(http)
        .post('/api/v1/files')
        .set(auth(owner.token))
        .field('ownerType', 'TENANT')
        .field('ownerId', tenantId)
        .field('category', 'ID_DOCUMENT')
        .attach('file', pdf, { filename: '../BI "Ana".pdf', contentType: 'image/png' })
        .expect(201);
      // O tipo vem do conteúdo, não do que o browser diz; o nome fica limpo.
      expect(up.body).toMatchObject({ contentType: 'application/pdf', filename: 'BI Ana.pdf', visibility: 'PRIVATE', url: null });

      const list = await request(http).get('/api/v1/files').query({ ownerType: 'TENANT', ownerId: tenantId }).set(auth(owner.token)).expect(200);
      expect(list.body).toHaveLength(1);
      const content = await request(http).get(`/api/v1/files/${up.body.id}/content`).set(auth(owner.token)).buffer(true).parse(binary).expect(200);
      expect((content.body as Buffer).equals(pdf)).toBe(true);
      expect(content.headers['x-content-type-options']).toBe('nosniff');
      expect(content.headers['content-security-policy']).toContain('sandbox');

      const shared = await request(http).patch(`/api/v1/files/${up.body.id}`).set(auth(owner.token)).send({ sharedWithTenant: true }).expect(200);
      expect(shared.body.sharedWithTenant).toBe(true);
    });

    it('recusa tipos não suportados, ficheiros grandes, categorias erradas e donos de outra organização', async () => {
      const html = await request(http).post('/api/v1/files').set(auth(owner.token))
        .field('ownerType', 'TENANT').field('ownerId', tenantId).field('category', 'OTHER')
        .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'x.pdf', contentType: 'application/pdf' })
        .expect(400);
      expect(html.body.error.code).toBe('UNSUPPORTED_FILE');

      const big = await request(http).post('/api/v1/files').set(auth(owner.token))
        .field('ownerType', 'TENANT').field('ownerId', tenantId).field('category', 'OTHER')
        .attach('file', Buffer.concat([pdf, Buffer.alloc(3 * 1024 * 1024)]), 'grande.pdf')
        .expect(413);
      expect(big.body.error.code).toBe('FILE_TOO_LARGE');

      const cat = await request(http).post('/api/v1/files').set(auth(owner.token))
        .field('ownerType', 'TENANT').field('ownerId', tenantId).field('category', 'COVER')
        .attach('file', pdf, 'a.pdf').expect(400);
      expect(cat.body.error.code).toBe('INVALID_CATEGORY');

      const other = await registerStaff(app);
      await request(http).post('/api/v1/files').set(auth(other.token))
        .field('ownerType', 'TENANT').field('ownerId', tenantId).field('category', 'OTHER')
        .attach('file', pdf, 'a.pdf').expect(404);
      const mine = await prisma.storedFile.findFirstOrThrow({ where: { ownerId: tenantId } });
      await request(http).get(`/api/v1/files/${mine.id}/content`).set(auth(other.token)).expect(404);
      await request(http).delete(`/api/v1/files/${mine.id}`).set(auth(other.token)).expect(404);
    });

    it('fotografias: metadados (GPS) removidos, imagens grandes reduzidas', async () => {
      const exif = await sharp({ create: { width: 3600, height: 2000, channels: 3, background: '#4a7' } })
        .jpeg()
        .withExif({ IFD0: { Make: 'Telemovel', Model: 'X' }, GPS: { GPSLatitudeRef: 'S', GPSLatitude: '25/1 58/1 0/1' } } as never)
        .toBuffer();
      expect((await sharp(exif).metadata()).exif).toBeTruthy();
      const up = await request(http).post('/api/v1/files').set(auth(owner.token))
        .field('ownerType', 'PROPERTY').field('ownerId', propertyId).field('category', 'PHOTO')
        .attach('file', exif, 'casa.jpeg').expect(201);
      expect(up.body).toMatchObject({ contentType: 'image/jpeg', width: 2400, filename: 'casa.jpg' });
      const stored = await request(http).get(`/api/v1/files/${up.body.id}/content`).set(auth(owner.token)).buffer(true).parse(binary).expect(200);
      const meta = await sharp(stored.body as Buffer).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.width).toBe(2400);
    });

    it('fotografias de anúncios são públicas, sincronizam o anúncio e voltam a revisão', async () => {
      const listing = await request(http).post('/api/v1/marketplace/my-listings').set(auth(owner.token)).send({
        title: 'T2 na Polana', description: 'Apartamento T2 com varanda, perto do mar e de escolas.', purpose: 'RENT', propertyType: 'APARTMENT',
        price: 3_500_000, currency: 'MZN', priceNegotiable: false, city: 'Maputo', durationDays: 30,
      }).expect(201);
      await prisma.listing.update({ where: { id: listing.body.id }, data: { status: 'ACTIVE' } });
      const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#123' } }).png().toBuffer();
      const up = await request(http).post('/api/v1/files').set(auth(owner.token))
        .field('ownerType', 'LISTING').field('ownerId', listing.body.id).field('category', 'PHOTO')
        .attach('file', png, 'sala.png').expect(201);
      expect(up.body.visibility).toBe('PUBLIC');
      expect(up.body.url).toBe(`http://localhost:3000/api/v1/public/files/${up.body.id}`);
      let l = await prisma.listing.findUniqueOrThrow({ where: { id: listing.body.id } });
      expect(l.imageUrls).toEqual([up.body.url]);
      expect(l.status).toBe('PENDING_REVIEW');

      const pub = await request(http).get(`/api/v1/public/files/${up.body.id}`).buffer(true).parse(binary).expect(200);
      expect(pub.headers['cache-control']).toContain('immutable');
      // Um PDF não pode ser público; e ficheiros privados não aparecem pela rota pública.
      const priv = await prisma.storedFile.findFirstOrThrow({ where: { ownerType: 'TENANT', ownerId: tenantId } });
      await request(http).get(`/api/v1/public/files/${priv.id}`).expect(404);
      const pdfListing = await request(http).post('/api/v1/files').set(auth(owner.token))
        .field('ownerType', 'LISTING').field('ownerId', listing.body.id).field('category', 'PHOTO')
        .attach('file', pdf, 'x.pdf').expect(400);
      expect(pdfListing.body.error.code).toBe('IMAGE_REQUIRED');

      await request(http).delete(`/api/v1/files/${up.body.id}`).set(auth(owner.token)).expect(204);
      l = await prisma.listing.findUniqueOrThrow({ where: { id: listing.body.id } });
      expect(l.imageUrls).toEqual([]);
      await request(http).get(`/api/v1/public/files/${up.body.id}`).expect(404);
    });

    it('o inquilino vê no portal só os documentos partilhados', async () => {
      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } });
      // Ativar o portal do inquilino diretamente (o fluxo do convite está testado em portal.e2e-spec).
      const account = await prisma.tenantAccount.create({ data: { phone: `+25884${Date.now().toString().slice(-7)}`, passwordHash: 'x' } });
      await prisma.tenant.update({ where: { id: lease.tenantId }, data: { accountId: account.id } });
      const files = app.get((await import('../src/modules/files/files.service')).FilesService);
      const visible = await files.listForTenantAccount(account.id);
      expect(visible.map((f) => f.filename)).toEqual(['BI Ana.pdf']);
      const photo = await prisma.storedFile.findFirstOrThrow({ where: { ownerType: 'PROPERTY' } });
      await expect(files.getForTenantAccount(account.id, photo.id)).rejects.toThrow();
    });
  });

  describe('Contratos', () => {
    it('modelo base, variáveis desconhecidas recusadas, personalizar e repor', async () => {
      const t = await request(http).get('/api/v1/organization/contract-template').set(auth(owner.token)).expect(200);
      expect(t.body.isDefault).toBe(true);
      expect(t.body.template).toContain('{{inquilino.nome}}');
      expect(t.body.variables.length).toBeGreaterThan(20);

      const bad = await request(http).put('/api/v1/organization/contract-template').set(auth(owner.token))
        .send({ template: `${t.body.template}\n{{inquilino.salario}}` }).expect(422);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');

      const mine = '# Contrato\n\nEntre **{{senhorio.nome}}** e **{{inquilino.nome}}**, renda de {{contrato.renda}} ({{contrato.renda_extenso}}), caução {{contrato.caucao_extenso}}, prazo {{contrato.prazo}}.\n\n[assinaturas]';
      const saved = await request(http).put('/api/v1/organization/contract-template').set(auth(owner.token)).send({ template: mine }).expect(200);
      expect(saved.body.isDefault).toBe(false);

      const preview = await request(http).post('/api/v1/organization/contract-template/preview').set(auth(owner.token)).send({}).buffer(true).parse(binary).expect(200);
      expect((preview.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

      const reset = await request(http).delete('/api/v1/organization/contract-template').set(auth(owner.token)).expect(200);
      expect(reset.body.isDefault).toBe(true);
      await request(http).put('/api/v1/organization/contract-template').set(auth(owner.token)).send({ template: mine }).expect(200);
    });

    it('PDF do contrato preenchido com os dados reais', async () => {
      const contracts = app.get((await import('../src/modules/contracts/contracts.module')).ContractsService);
      const { vars } = await contracts.varsForLease(owner.organizationId, leaseId);
      expect(vars).toMatchObject({
        'inquilino.nome': 'Ana Maria Sitoe',
        'inquilino.estado_civil': 'solteiro(a)',
        'contrato.renda_extenso': 'vinte e cinco mil meticais',
        'contrato.caucao_extenso': 'cinquenta mil meticais',
        'contrato.prazo': 'duração indeterminada',
        'contrato.duracao': 'é celebrado por tempo indeterminado',
        'senhorio.nome': 'Imóveis Relatório',
      });
      const res = await request(http).get(`/api/v1/leases/${leaseId}/contract.pdf`).set(auth(owner.token)).buffer(true).parse(binary).expect(200);
      expect(res.headers['content-disposition']).toContain('contrato-ana-maria-sitoe.pdf');
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

      const other = await registerStaff(app);
      await request(http).get(`/api/v1/leases/${leaseId}/contract.pdf`).set(auth(other.token)).expect(404);
    });
  });
});
