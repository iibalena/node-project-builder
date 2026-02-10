import { Body, Controller, Get, Post } from '@nestjs/common';
import { ReposService } from './repos.service';

@Controller('repos')
export class ReposController {
  constructor(private readonly reposService: ReposService) {}

  @Post()
  async create(
    @Body()
    body: { owner: string; name: string; cloneUrl: string; defaultBranch?: string },
  ) {
    return this.reposService.create(body);
  }

  @Get()
  async list() {
    return this.reposService.list();
  }
}
