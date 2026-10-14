import { Module } from '@nestjs/common';

import { PhotosController } from './photos.controller.js';
import { PhotosService } from './photos.service.js';

/** End-to-end encrypted profile photos (docs/ADR/0014). */
@Module({
  controllers: [PhotosController],
  providers: [PhotosService],
})
export class PhotosModule {}
