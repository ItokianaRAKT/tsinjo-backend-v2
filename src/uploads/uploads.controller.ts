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
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

export const OFFERS_UPLOAD_DIR = join(process.cwd(), 'uploads', 'offers');
export const OFFERS_URL_PREFIX = '/uploads/offers/';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
const MAX_FILES = 5;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

mkdirSync(OFFERS_UPLOAD_DIR, { recursive: true });

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  @Post('offer-images')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      storage: diskStorage({
        destination: OFFERS_UPLOAD_DIR,
        filename: (_req: Request, file, callback) => {
          const extension = EXTENSION_BY_MIME[file.mimetype] ?? '';
          callback(null, `${randomUUID()}${extension}`);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, callback) => {
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
    return {
      urls: files.map((file) => `${OFFERS_URL_PREFIX}${file.filename}`),
    };
  }
}
