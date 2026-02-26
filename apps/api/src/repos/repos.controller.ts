import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ReposService } from './repos.service';
import { CreateRepoDto } from './dto/create-repo.dto';
import { UpdateRepoDto } from './dto/update-repo.dto';

@Controller('repos')
export class ReposController {
  constructor(private readonly reposService: ReposService) {}

  @Post()
  async create(@Body() body: CreateRepoDto) {
    return this.reposService.create(body);
  }

  @Get()
  async list() {
    return this.reposService.list();
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateRepoDto,
  ) {
    return this.reposService.update(id, body);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.reposService.delete(Number(id));
  }
}
