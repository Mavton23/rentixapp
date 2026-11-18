import PDFDocument from 'pdfkit';

/** Valor que fica por preencher à mão (dado em falta na ficha). */
export const BLANK = '____________________';

export type Block =
  | { kind: 'h1' | 'h2' | 'p' | 'li'; text: string }
  | { kind: 'signatures' };

/** Substitui {{variáveis}}; as que não têm valor ficam como um traço para preencher à mão. */
export function fillTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === null || v === undefined || v.trim() === '' ? BLANK : v;
  });
}

/** Markdown simples → blocos: "# ", "## ", "- ", [assinaturas] e parágrafos (linhas seguidas juntam-se). */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) flush();
    else if (line === '[assinaturas]') {
      flush();
      blocks.push({ kind: 'signatures' });
    } else if (line.startsWith('## ')) {
      flush();
      blocks.push({ kind: 'h2', text: line.slice(3) });
    } else if (line.startsWith('# ')) {
      flush();
      blocks.push({ kind: 'h1', text: line.slice(2) });
    } else if (/^[-*] /.test(line)) {
      flush();
      blocks.push({ kind: 'li', text: line.slice(2) });
    } else para.push(line);
  }
  flush();
  return blocks;
}

const INK = '#111827';
const SOFT = '#4b5563';

export interface ContractPdfOptions {
  title: string;
  parties: { landlord: string; tenant: string };
  /** Rodapé de cada página (ex.: identificação do contrato). */
  footer: string;
  /** Marca d'água para pré-visualizações com dados de exemplo. */
  watermark?: string;
  /** Textos fixos do PDF (assinaturas, paginação). */
  labels?: { landlord: string; tenant: string; page: (n: number, total: number) => string };
}

/** Gera o PDF do contrato: A4, texto justificado, títulos, alíneas, negrito, assinaturas e paginação. */
export function renderContractPdf(blocks: Block[], opts: ContractPdfOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 72, left: 68, right: 68 }, bufferPages: true, info: { Title: opts.title, Creator: 'Rentix' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    /** Texto com **negrito**, em segmentos contínuos (o pdfkit mantém a justificação). */
    const rich = (text: string, x: number, w: number, size: number, align: 'justify' | 'left' | 'center') => {
      // Segmentos alternados: os ímpares estão entre ** (negrito). Os vazios descartam-se.
      const parts = text
        .split('**')
        .map((seg, i) => ({ seg, bold: i % 2 === 1 }))
        .filter((p) => p.seg !== '');
      if (!parts.length) return;
      // O pdfkit corta o espaço inicial de um segmento contínuo: passa-o para o fim do anterior.
      for (let i = 1; i < parts.length; i++) {
        const lead = /^\s+/.exec(parts[i]!.seg)?.[0];
        if (lead) {
          parts[i - 1]!.seg += lead;
          parts[i]!.seg = parts[i]!.seg.slice(lead.length);
        }
      }
      doc.fontSize(size).fillColor(INK);
      // Com "continued", só a primeira chamada leva posição e largura; as seguintes continuam a linha.
      parts.forEach(({ seg, bold }, i) => {
        doc.font(bold ? 'Times-Bold' : 'Times-Roman');
        const continued = i < parts.length - 1;
        if (i === 0) doc.text(seg, x, doc.y, { width: w, align, continued, lineGap: 2.5 });
        else doc.text(seg, { continued });
      });
    };

    for (const b of blocks) {
      if (b.kind === 'h1') {
        doc.font('Times-Bold').fontSize(16).fillColor(INK).text(b.text.toUpperCase(), left, doc.y, { width, align: 'center', characterSpacing: 0.4 });
        doc.moveDown(1.2);
      } else if (b.kind === 'h2') {
        // Não deixar um título sozinho no fim da página.
        if (doc.y > bottom() - 70) doc.addPage();
        doc.moveDown(0.5);
        doc.font('Times-Bold').fontSize(11.5).fillColor(INK).text(b.text, left, doc.y, { width });
        doc.moveDown(0.35);
      } else if (b.kind === 'p') {
        rich(b.text, left, width, 11, 'justify');
        doc.moveDown(0.6);
      } else if (b.kind === 'li') {
        // A alínea inteira passa para a página seguinte se não couber (o marcador fica com o texto).
        const h = doc.font('Times-Roman').fontSize(11).heightOfString(b.text.replace(/\*\*/g, ''), { width: width - 20, lineGap: 2.5 });
        if (doc.y + h > bottom()) doc.addPage();
        const y = doc.y;
        doc.font('Times-Roman').fontSize(11).fillColor(INK).text('•', left + 6, y, { width: 10, lineBreak: false });
        doc.y = y;
        rich(b.text, left + 20, width - 20, 11, 'justify');
        doc.moveDown(0.3);
      } else {
        if (doc.y > bottom() - 140) doc.addPage();
        doc.moveDown(2);
        const y = doc.y + 40;
        const colW = (width - 40) / 2;
        const sig = (x: number, role: string, name: string) => {
          doc.moveTo(x, y).lineTo(x + colW, y).lineWidth(0.6).strokeColor(SOFT).stroke();
          doc.font('Times-Bold').fontSize(10.5).fillColor(INK).text(role, x, y + 6, { width: colW, align: 'center' });
          doc.font('Times-Roman').fontSize(10).fillColor(SOFT).text(name, x, doc.y + 1, { width: colW, align: 'center' });
        };
        sig(left, opts.labels?.landlord ?? 'O Senhorio', opts.parties.landlord);
        sig(left + colW + 40, opts.labels?.tenant ?? 'O Inquilino', opts.parties.tenant);
        doc.y = y + 50;
        doc.x = left;
      }
    }

    // Rodapé e paginação ("rubricar todas as páginas" é prática comum: fica o espaço indicado).
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Escrever no rodapé (abaixo da margem) sem o pdfkit abrir uma página nova.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 48;
      doc.font('Helvetica').fontSize(7.5).fillColor('#6b7280');
      doc.text(opts.footer, left, y, { width: width * 0.7, lineBreak: false });
      doc.text(opts.labels ? opts.labels.page(i + 1, range.count) : `Página ${i + 1} de ${range.count}   Rubricas: ______  ______`, left, y, { width, align: 'right', lineBreak: false });
      if (opts.watermark) {
        doc.save();
        doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc.font('Helvetica-Bold').fontSize(64).fillColor('#e5e7eb').opacity(0.6);
        doc.text(opts.watermark, 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center', lineBreak: false });
        doc.restore();
      }
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
  });
}
