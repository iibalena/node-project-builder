import { Controller, Get, Res } from '@nestjs/common';
import * as path from 'path';

const getDashboardIndexPath = () =>
  path.join(__dirname, '..', '..', '..', 'apps', 'api', 'public', 'index.html');

@Controller()
export class DashboardController {
  @Get('dashboard')
  getDashboard(@Res() res: any) {
    return res.sendFile(getDashboardIndexPath());
  }
}
