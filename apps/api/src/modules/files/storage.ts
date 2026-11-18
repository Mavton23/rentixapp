import { Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { AppConfig } from '../../config/app-config.service';

/** Onde os ficheiros ficam guardados. A base de dados só guarda a chave e os metadados. */
export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

/** Pasta no disco. Bom para desenvolvimento e para um só servidor com volume persistente. */
export class LocalStorage implements StorageDriver {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  private path(key: string): string {
    const p = resolve(join(this.root, key));
    // A chave é gerada pela API, mas nunca se sai da pasta raiz.
    if (!p.startsWith(this.root + sep)) throw new Error('Chave de armazenamento inválida');
    return p;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { flag: 'wx' });
  }

  get(key: string): Promise<Readable> {
    return Promise.resolve(createReadStream(this.path(key)));
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** AWS S3 ou compatível (Cloudflare R2, DigitalOcean Spaces, MinIO). O bucket fica privado. */
export class S3Storage implements StorageDriver {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

@Injectable()
export class StorageService implements StorageDriver {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;

  constructor(config: AppConfig) {
    if (config.get('STORAGE_DRIVER') === 's3') {
      this.driver = new S3Storage(
        new S3Client({
          region: config.get('S3_REGION'),
          endpoint: config.get('S3_ENDPOINT'),
          forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
          credentials: { accessKeyId: config.get('S3_ACCESS_KEY_ID')!, secretAccessKey: config.get('S3_SECRET_ACCESS_KEY')! },
        }),
        config.get('S3_BUCKET')!,
      );
    } else {
      this.driver = new LocalStorage(config.get('STORAGE_DIR'));
    }
  }

  put(key: string, body: Buffer, contentType: string) {
    return this.driver.put(key, body, contentType);
  }

  get(key: string) {
    return this.driver.get(key);
  }

  /** Para /health/ready: escreve, lê e apaga um objeto pequeno. */
  async ping(): Promise<void> {
    const key = `.health/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    await this.driver.put(key, Buffer.from('ok'), 'text/plain');
    const stream = await this.driver.get(key);
    for await (const _ of stream) break;
    stream.destroy();
    await this.driver.delete(key);
  }

  /** Apagar não deve falhar a operação do utilizador: um objeto órfão é inofensivo. */
  async delete(key: string): Promise<void> {
    try {
      await this.driver.delete(key);
    } catch (err) {
      this.logger.warn({ err, key }, 'Não foi possível apagar o objeto do armazenamento');
    }
  }
}
