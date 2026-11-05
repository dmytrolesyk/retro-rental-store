import { ApiProperty } from '@nestjs/swagger';

export class GameSummaryDto {
  @ApiProperty({ format: 'uuid' }) gameId: string;
  @ApiProperty() name: string;
  @ApiProperty() nameUk: string;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) releaseDate: string | null;
  @ApiProperty({ type: String, nullable: true }) gameCoverUrl: string | null;
}

export class GamePlatformDto {
  @ApiProperty({ format: 'uuid' }) platformId: string;
  @ApiProperty() name: string;
}

export class GameDetailDto extends GameSummaryDto {
  @ApiProperty() description: string;
  @ApiProperty() descriptionUk: string;
  @ApiProperty({ type: [GamePlatformDto] }) platforms: GamePlatformDto[];
}

export class GamePageDto {
  @ApiProperty({ type: [GameSummaryDto] }) items: GameSummaryDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Opaque token for the next page; null when there are no more items.',
  })
  next_cursor: string | null;
}
