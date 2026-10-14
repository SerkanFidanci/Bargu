import { Module } from '@nestjs/common';

import { WeatherController } from './weather.controller.js';
import { WeatherService } from './weather.service.js';

/** Weather for the map's ambient animation (docs/ADR/0013). The worker fetches it. */
@Module({
  controllers: [WeatherController],
  providers: [WeatherService],
})
export class WeatherModule {}
