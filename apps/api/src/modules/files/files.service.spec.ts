import { cleanFilename, detectType } from './files.service';
import { LocalStorage } from './storage';

describe('ficheiros', () => {
  it('deteta o tipo pelos primeiros bytes, não pela extensão', () => {
    expect(detectType(Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj'))?.contentType).toBe('application/pdf');
    expect(detectType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]))?.ext).toBe('jpg');
    expect(detectType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]))?.ext).toBe('png');
    expect(detectType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))?.ext).toBe('webp');
    // HTML disfarçado de PDF, executáveis e texto não passam.
    expect(detectType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectType(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00', 'latin1'))).toBeNull();
  });

  it('limpa nomes de ficheiros (caminhos, aspas, controlo) e força a extensão real', () => {
    expect(cleanFilename('../../etc/passwd', 'pdf')).toBe('passwd.pdf');
    expect(cleanFilename('C:\\Docs\\BI "Ana".jpeg', 'jpg')).toBe('BI Ana.jpg');
    expect(cleanFilename('contrato\u0000\u0007.exe', 'pdf')).toBe('contrato.pdf');
    expect(cleanFilename('', 'png')).toBe('ficheiro.png');
  });

  it('o armazenamento local nunca sai da pasta raiz', async () => {
    const s = new LocalStorage('/tmp/rentix-storage-test');
    await expect(s.put('../fora.txt', Buffer.from('x'))).rejects.toThrow('Chave de armazenamento inválida');
  });
});
