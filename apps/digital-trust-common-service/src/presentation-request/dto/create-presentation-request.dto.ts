import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { IsDefined, IsObject, IsUUID, ValidateNested } from 'class-validator';

export class PresentationRequestDeliveryDto {
  @Expose({ name: 'connection_id' })
  @ApiProperty({ name: 'connection_id', format: 'uuid' })
  @IsUUID()
  public connectionId!: string;
}

export class CreatePresentationRequestDto {
  @Expose({ name: 'verification_profile_id' })
  @ApiProperty({
    name: 'verification_profile_id',
    format: 'uuid',
    description: 'Published verification profile UUID',
  })
  @IsUUID()
  public verificationProfileId!: string;

  @ApiProperty({ type: PresentationRequestDeliveryDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PresentationRequestDeliveryDto)
  public delivery!: PresentationRequestDeliveryDto;
}
