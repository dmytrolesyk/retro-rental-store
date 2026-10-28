import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { GameDetailDto, GamePageDto } from './catalog.dto';
import { PaginationPipe } from '../common/pagination';
import type { PageQuery } from '../common/pagination';
import { ApiPagination } from '../common/api-pagination.decorator';
import { ApiProblems } from '../common/api-problems.decorator';

@ApiTags('games')
@Controller('games')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({ operationId: 'listGames', summary: 'List games in stable UUID order' })
  @ApiPagination()
  @ApiOkResponse({ type: GamePageDto, description: 'One page of games.' })
  @ApiProblems(400, 500)
  list(@Query(new PaginationPipe('games')) page: PageQuery): Promise<GamePageDto> {
    return this.catalog.list(page);
  }

  @Get(':gameId')
  @ApiOperation({ operationId: 'getGame', summary: 'Get a game and its platforms' })
  @ApiParam({ name: 'gameId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({
    type: GameDetailDto,
    description: 'Game details and platform identifiers for checkout.',
  })
  @ApiProblems(400, 404, 500)
  get(@Param('gameId', new ParseUUIDPipe()) gameId: string): Promise<GameDetailDto> {
    return this.catalog.get(gameId);
  }
}
