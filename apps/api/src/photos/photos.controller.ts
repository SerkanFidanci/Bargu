import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { type Photo, photoUploadSchema } from '@bargu/schemas';
import { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PhotosService } from './photos.service.js';

/** Encrypted profile photos: put or remove one's own, fetch a circle-mate's (docs/ADR/0014). */
@Controller('v1')
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Put('me/photo')
  @HttpCode(HttpStatus.NO_CONTENT)
  async put(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(photoUploadSchema)) body: Photo,
  ): Promise<void> {
    await this.photos.put(auth, body);
  }

  @Delete('me/photo')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.photos.remove(auth);
  }

  @Get('users/:userId/photo')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ZodPipe(z.uuid())) userId: string,
  ): Promise<Photo> {
    return this.photos.get(auth, userId);
  }
}
