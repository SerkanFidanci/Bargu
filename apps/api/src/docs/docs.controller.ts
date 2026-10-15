import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { type DocPut, docPutSchema, type DocRecord } from '@bargu/schemas';
import { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DocsService } from './docs.service.js';

/** Documents of event circles: the meeting, polls and votes (docs/ADR/0018). */
@Controller('v1/circles/:circleId/docs')
export class DocsController {
  constructor(private readonly docs: DocsService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @Param('circleId', new ZodPipe(z.uuid())) circleId: string,
  ): Promise<{ docs: DocRecord[] }> {
    return { docs: await this.docs.list(auth, circleId) };
  }

  @Put(':docId')
  @HttpCode(HttpStatus.OK)
  put(
    @CurrentAuth() auth: AuthContext,
    @Param('circleId', new ZodPipe(z.uuid())) circleId: string,
    @Param('docId', new ZodPipe(z.uuid())) docId: string,
    @Body(new ZodPipe(docPutSchema)) body: DocPut,
  ): Promise<{ version: number }> {
    return this.docs.put(auth, circleId, docId, body);
  }

  @Delete(':docId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('circleId', new ZodPipe(z.uuid())) circleId: string,
    @Param('docId', new ZodPipe(z.uuid())) docId: string,
  ): Promise<void> {
    await this.docs.remove(auth, circleId, docId);
  }
}
