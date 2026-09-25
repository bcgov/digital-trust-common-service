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
  @Expose()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public attribute!: string;

  @Expose()
  @IsEnum(VerificationPredicateCondition)
  public condition!: VerificationPredicateCondition;

  @Expose()
  @IsString()
  @MinLength(1)
  public value!: string;
}
