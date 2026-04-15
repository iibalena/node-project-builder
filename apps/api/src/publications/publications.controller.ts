import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { PublicationsService } from './publications.service';
import { PlanPublicationDto } from './dto/plan-publication.dto';
import { CreatePublicationDto } from './dto/create-publication.dto';
import { UpdatePublicationStatusDto } from './dto/update-publication-status.dto';
import { ListPublicationsDto } from './dto/list-publications.dto';

@Controller('publications')
export class PublicationsController {
  constructor(private readonly publicationsService: PublicationsService) {}

  @Post('plan')
  async plan(@Body() body: PlanPublicationDto) {
    return this.publicationsService.plan(body);
  }

  @Post()
  async create(@Body() body: CreatePublicationDto) {
    return this.publicationsService.create(body);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdatePublicationStatusDto,
  ) {
    return this.publicationsService.updateStatus(id, body);
  }

  @Get()
  async list(@Query() query: ListPublicationsDto) {
    return this.publicationsService.list(query);
  }
}
