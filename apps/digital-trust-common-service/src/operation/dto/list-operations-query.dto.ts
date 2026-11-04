import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

import { ListOperationItemsQueryDto } from './list-operation-items-query.dto';

export class ListOperationsQueryDto extends ListOperationItemsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter operations by exact type',
    example: 'credential.offer',
    minLength: 1,
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  public type?: string;
}
