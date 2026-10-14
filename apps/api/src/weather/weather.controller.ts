import { Controller, Get, HttpStatus } from '@nestjs/common';
import type { WeatherSnapshot } from '@bargu/schemas';

import { ApiError } from '../common/api-error.js';
import { WeatherService } from './weather.service.js';

/**
 * The current weather grid, the same for everyone: the phone looks up its own cell, so its
 * location is never sent (docs/ADR/0013). Signed in only, like everything else.
 */
@Controller('v1/weather')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get()
  async current(): Promise<WeatherSnapshot> {
    const snapshot = await this.weather.snapshot();
    if (snapshot === null) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    }
    return snapshot;
  }
}
