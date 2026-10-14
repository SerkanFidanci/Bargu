import { Module } from '@nestjs/common';

import { RelayModule } from '../relay/relay.module.js';
import { PlacesController } from './places.controller.js';
import { PlacesService } from './places.service.js';

/** End-to-end encrypted places of circles and arrival notifications (Faz 7, docs/ADR/0015). */
@Module({
  imports: [RelayModule],
  controllers: [PlacesController],
  providers: [PlacesService],
})
export class PlacesModule {}
