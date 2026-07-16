import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateContactDto } from '../contact/dto/create-contact.dto';
import { Lead } from '../entities/lead.entity';
import { MailService } from './mail.service';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepository: Repository<Lead>,
    private readonly mailService: MailService,
  ) {}

  async create(dto: CreateContactDto) {
    const lead = await this.leadsRepository.save(
      this.leadsRepository.create({
        name: dto.name,
        email: dto.email,
        inquiry: dto.inquiry,
        message: dto.message,
      }),
    );

    try {
      await this.mailService.sendContactReceived(
        lead.email,
        lead.name,
        lead.inquiry,
      );
      await this.mailService.sendContactOwnerNotify(lead);
    } catch (error) {
      this.logger.error('Failed to send contact emails after saving lead', error);
    }

    return {
      message: 'Thank you for contacting us. We have received your inquiry.',
    };
  }
}
