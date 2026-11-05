import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Game } from './entities/game.entity';
import { pageOf } from '../common/pagination';
import type { PageQuery } from '../common/pagination';
import type { GameDetailDto, GamePageDto } from './catalog.dto';

function summary(game: Game) {
  return {
    gameId: game.gameId,
    name: game.name,
    nameUk: game.nameUk,
    releaseDate: game.releaseDate,
    gameCoverUrl: game.gameCoverUrl,
  };
}

@Injectable()
export class CatalogService {
  constructor(private readonly db: DataSource) {}

  async list(page: PageQuery): Promise<GamePageDto> {
    const query = this.db
      .getRepository(Game)
      .createQueryBuilder('game')
      .orderBy('game.gameId', 'ASC')
      .take(page.limit + 1);
    if (page.after) query.where('game.gameId > :after', { after: page.after });
    return pageOf((await query.getMany()).map(summary), page, 'games', game => game.gameId);
  }

  async get(gameId: string): Promise<GameDetailDto> {
    const game = await this.db
      .getRepository(Game)
      .findOne({ where: { gameId }, relations: { gamePlatforms: { platform: true } } });
    if (!game) throw new NotFoundException('Game not found');
    return {
      ...summary(game),
      description: game.description,
      descriptionUk: game.descriptionUk,
      platforms: game.gamePlatforms
        .map(link => ({ platformId: link.platformId, name: link.platform.name }))
        .sort((a, b) => a.platformId.localeCompare(b.platformId)),
    };
  }
}
