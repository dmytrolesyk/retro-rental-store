import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { PROBLEM_CONTENT_TYPE, PROBLEM_DESCRIPTIONS } from './problem.constants';
import { Problem } from './problem.dto';

export function ApiProblems(...statuses: (keyof typeof PROBLEM_DESCRIPTIONS)[]) {
  return applyDecorators(
    ApiExtraModels(Problem),
    ...statuses.map(status =>
      ApiResponse({
        status,
        description: PROBLEM_DESCRIPTIONS[status],
        content: { [PROBLEM_CONTENT_TYPE]: { schema: { $ref: getSchemaPath(Problem) } } },
      }),
    ),
  );
}
