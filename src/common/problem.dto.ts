import { ApiProperty } from '@nestjs/swagger';
import { PROBLEM_TYPE_PREFIX } from './problem.constants';

// Keep the class name: it is the public OpenAPI components.schemas.Problem name.
export class Problem {
  @ApiProperty({ format: 'uri', example: `${PROBLEM_TYPE_PREFIX}bad-request` })
  type: string;
  @ApiProperty({ example: 'bad request' })
  title: string;
  @ApiProperty({ type: 'integer', minimum: 400, maximum: 599, example: 400 })
  status: number;
  @ApiProperty({ example: 'Invalid UUID' })
  detail: string;
  @ApiProperty({ format: 'uri-reference', example: '/rentals' })
  instance: string;
}
