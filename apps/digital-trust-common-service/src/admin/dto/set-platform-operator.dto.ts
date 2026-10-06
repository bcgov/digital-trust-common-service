import { Expose } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class SetPlatformOperatorDto {
  @Expose({ name: 'is_platform_operator' })
  @IsBoolean()
  public isPlatformOperator!: boolean;
}
