import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ReposService } from './repos.service';

@Controller('repos')
export class ReposController {
  constructor(private readonly reposService: ReposService) {}

  @Post()
  async create(
    @Body()
    body: {
      owner: string;
      name: string;
      cloneUrl?: string;
      defaultBranch?: string;
      installCommand?: string;
      useLegacyPeerDeps?: boolean;
    },
  ) {
    return this.reposService.create(body);
  }

  @Get()
  async list() {
    return this.reposService.list();
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.reposService.delete(Number(id));
  }
}
