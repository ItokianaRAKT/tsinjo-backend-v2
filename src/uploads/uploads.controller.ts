import {
  BadRequestException,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

export const OFFERS_UPLOAD_DIR = join(process.cwd(), 'uploads', 'offers');
export const OFFERS_URL_PREFIX = '/uploads/offers/';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
const MAX_FILES = 5;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Détecte le type réel par signature binaire : le MIME déclaré par le client est falsifiable. */
export function detectImageExtension(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return '.jpg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return '.png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return '.webp';
  }
  return null;
}

mkdirSync(OFFERS_UPLOAD_DIR, { recursive: true });

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  @Post('offer-images')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      // En mémoire le temps de vérifier la signature, puis écrit sous un nom UUID.
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
      fileFilter: (_req: Request, file, callback) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          callback(
            new BadRequestException(
              `Unsupported image type "${file.mimetype}". Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload 1 to 5 real offer images (JPEG/PNG/WebP, max 5 Mo each)',
    description:
      'Sends back the public URLs served statically on /uploads/offers/...',
  })
  uploadOfferImages(@UploadedFiles() files?: Express.Multer.File[]): {
    urls: string[];
  } {
    if (!files || files.length < 1) {
      throw new BadRequestException('At least 1 image is required (field "files")');
    }
    const written: string[] = [];
    try {
      const urls = files.map((file) => {
        const extension = detectImageExtension(file.buffer);
        if (!extension) {
          throw new BadRequestException(
            'Invalid image content: only real JPEG, PNG or WebP files are accepted',
          );
        }
        // Nom entièrement généré côté serveur : aucune donnée client dans le chemin.
        const filename = `${randomUUID()}${extension}`;
        writeFileSync(join(OFFERS_UPLOAD_DIR, filename), file.buffer);
        written.push(filename);
        return `${OFFERS_URL_PREFIX}${filename}`;
      });
      return { urls };
    } catch (error) {
      for (const filename of written) {
        rmSync(join(OFFERS_UPLOAD_DIR, filename), { force: true });
      }
      throw error;
    }
  }
}
