import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { Public } from '../auth/request-context.js';
import { HealthService, type ReadinessReport } from './health.service.js';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: the process is up and serving HTTP. Never touches dependencies. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: every dependency answers. Responds 503 otherwise so traffic is held back. */
  @Get('ready')
  async ready(): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    if (report.status !== 'ok') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
