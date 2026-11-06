import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export enum VerificationPredicateCondition {
  LESS_THAN = '<',
  LESS_THAN_OR_EQUAL = '<=',
  GREATER_THAN_OR_EQUAL = '>=',
  GREATER_THAN = '>',
  EQUAL = '==',
}

/** Predicate constraint on an issuance profile attribute (DIF PE `filter`-style comparison). */
export class VerificationPredicateDto {
  @ApiProperty({ maxLength: 100 })
  @Expose()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public attribute!: string;

  @ApiProperty({ enum: VerificationPredicateCondition })
  @Expose()
  @IsEnum(VerificationPredicateCondition)
  public condition!: VerificationPredicateCondition;

  @ApiProperty({ description: 'Numeric threshold represented as a string' })
  @Expose()
  @IsString()
  @MinLength(1)
  public value!: string;
}
