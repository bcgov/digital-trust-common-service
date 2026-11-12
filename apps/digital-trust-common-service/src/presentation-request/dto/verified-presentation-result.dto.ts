import { ApiProperty } from '@nestjs/swagger';

class RevealedPresentationAttributeDto {
  @ApiProperty()
  public referent!: string;

  @ApiProperty()
  public name!: string;

  @ApiProperty()
  public value!: string;
}

class VerifiedPresentationPredicateDto {
  @ApiProperty()
  public referent!: string;

  @ApiProperty()
  public name!: string;

  @ApiProperty({ enum: ['<', '<=', '>=', '>'] })
  public operator!: string;

  @ApiProperty()
  public threshold!: number;

  @ApiProperty({ enum: [true] })
  public satisfied!: boolean;
}

export class VerifiedPresentationResultDto {
  @ApiProperty({ enum: [true] })
  public verified!: boolean;

  @ApiProperty({ type: [RevealedPresentationAttributeDto] })
  public revealed_attributes!: RevealedPresentationAttributeDto[];

  @ApiProperty({ type: [VerifiedPresentationPredicateDto] })
  public predicates!: VerifiedPresentationPredicateDto[];
}
