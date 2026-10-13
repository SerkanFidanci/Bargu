import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

import { ApiError } from './api-error.js';

/** Validates a request part against a shared schema (packages/schemas); rejects with 400. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    return result.data;
  }
}
