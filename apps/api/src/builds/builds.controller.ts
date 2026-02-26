import { Controller, Get, Query } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { ListBuildsDto } from './dto/list-builds.dto';

@Controller('builds')
export class BuildsController {
  constructor(private readonly buildsService: BuildsService) {}

  @Get()
  async list(@Query() query: ListBuildsDto) {
    return this.buildsService.list(query);
  }
}
