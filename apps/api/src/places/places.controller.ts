import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  type BumpReply,
  type PlaceEventRequest,
  placeEventRequestSchema,
  type PlacePut,
  placePutSchema,
  type PlaceRecord,
} from '@bargu/schemas';
import { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RelayService } from '../relay/relay.service.js';
import { PlacesService } from './places.service.js';

/** Places of circles (docs/ADR/0015) and the arrivals and departures at them. */
@Controller('v1')
export class PlacesController {
  constructor(
    private readonly places: PlacesService,
    private readonly relay: RelayService,
  ) {}

  @Get('places')
  async list(@CurrentAuth() auth: AuthContext): Promise<{ places: PlaceRecord[] }> {
    return { places: await this.places.list(auth) };
  }

  @Put('circles/:circleId/places/:placeId')
  @HttpCode(HttpStatus.OK)
  put(
    @CurrentAuth() auth: AuthContext,
    @Param('circleId', new ZodPipe(z.uuid())) circleId: string,
    @Param('placeId', new ZodPipe(z.uuid())) placeId: string,
    @Body(new ZodPipe(placePutSchema)) body: PlacePut,
  ): Promise<{ version: number }> {
    return this.places.put(auth, circleId, placeId, body);
  }

  @Delete('circles/:circleId/places/:placeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('circleId', new ZodPipe(z.uuid())) circleId: string,
    @Param('placeId', new ZodPipe(z.uuid())) placeId: string,
  ): Promise<void> {
    await this.places.remove(auth, circleId, placeId);
  }

  /**
   * "Ali arrived home", "Ali will be late": forwarded to the members online, sealed notifications to
   * the others (the server cannot tell which).
   */
  @Post('place-events')
  @HttpCode(HttpStatus.OK)
  event(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(placeEventRequestSchema)) body: PlaceEventRequest,
  ): Promise<BumpReply> {
    return this.relay.placeEvent(auth, body.envelope, body.pushes);
  }
}
