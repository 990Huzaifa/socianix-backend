import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CreateContactDto } from '../contact/dto/create-contact.dto';
import { ContactService } from '../services/contact.service';

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreateContactDto) {
    return this.contactService.create(dto);
  }
}
