import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ServiceSourceService } from '../services/service-source.service';
import {
  CreateServiceSourceDto,
  UpdateServiceSourceDto,
  ServiceSourceResponseDto,
} from '../dto/service-source.dto';

@Controller('api/services-sources')
@UseGuards(RolesGuard)
@Roles('MAJOR')
export class ServiceSourceController {
  constructor(private serviceSourceService: ServiceSourceService) {}

  @Post()
  async createService(
    @Body() dto: CreateServiceSourceDto,
  ): Promise<ServiceSourceResponseDto> {
    return this.serviceSourceService.createService(dto);
  }

  @Get()
  async listServices(): Promise<ServiceSourceResponseDto[]> {
    return this.serviceSourceService.listServices();
  }

  @Get(':id')
  async getServiceById(
    @Param('id') id: string,
  ): Promise<ServiceSourceResponseDto> {
    return this.serviceSourceService.getServiceById(id);
  }

  @Patch(':id')
  async updateService(
    @Param('id') id: string,
    @Body() dto: UpdateServiceSourceDto,
  ): Promise<ServiceSourceResponseDto> {
    return this.serviceSourceService.updateService(id, dto);
  }

  @Delete(':id')
  async deleteService(@Param('id') id: string): Promise<void> {
    return this.serviceSourceService.deleteService(id);
  }

  @Get('logs/webhooks')
  async getWebhookLogs(
    @Query('serviceSourceId') serviceSourceId?: string,
    @Query('limit') limit?: string,
  ): Promise<any[]> {
    return this.serviceSourceService.getWebhookLogs(
      serviceSourceId,
      limit ? parseInt(limit) : 50,
    );
  }
}
