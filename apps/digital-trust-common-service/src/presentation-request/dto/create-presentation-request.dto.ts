import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { IsDefined, IsObject, IsUUID, ValidateNested } from 'class-validator';

export class PresentationRequestDeliveryDto {
  @Expose({ name: 'connection_id' })
  @ApiProperty({
    name: 'connection_id',
    format: 'uuid',
    description:
      'Established local DIDComm connection belonging to this tenant',
  })
  @IsUUID()
  public connectionId!: string;
}

export class CreatePresentationRequestDto {
  @Expose({ name: 'presentation_definition_id' })
  @ApiProperty({
    name: 'presentation_definition_id',
    format: 'uuid',
    description:
      'Published reusable definition UUID (legacy verification profile UUIDs are also accepted)',
  })
  @IsUUID()
  public presentationDefinitionId!: string;

  @ApiProperty({ type: PresentationRequestDeliveryDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PresentationRequestDeliveryDto)
  public delivery!: PresentationRequestDeliveryDto;
}
