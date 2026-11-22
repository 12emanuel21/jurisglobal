import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitLeadDto } from './submit-lead.dto';

const valid = {
  fullName: '  Ana   María Pérez ',
  phone: '300 123 4567',
  email: ' Ana@Correo.CO ',
  motivo: 'Tránsito',
  origin: 'web',
  privacyAndTerms: true,
  contactAndDataProcessing: true,
};

async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(SubmitLeadDto, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, fields: errors.map((e) => e.property) };
}

describe('SubmitLeadDto', () => {
  it('acepta un envío válido y limpia nombre y correo', async () => {
    const { dto, fields } = await check(valid);
    expect(fields).toEqual([]);
    expect(dto.fullName).toBe('Ana María Pérez');
    expect(dto.email).toBe('ana@correo.co');
  });

  it.each([
    ['fullName', 'A1'],
    ['fullName', 'Juan <script>'],
    ['email', 'correo-malo'],
    ['origin', 'telefono'],
    ['privacyAndTerms', false],
    ['contactAndDataProcessing', 'true'],
    ['motivo', ''],
    ['phone', ''],
  ])('rechaza %s = %p', async (field, value) => {
    expect((await check({ ...valid, [field]: value })).fields).toContain(field);
  });

  it('exige ambas autorizaciones y rechaza campos desconocidos', async () => {
    const { privacyAndTerms, ...rest } = valid;
    void privacyAndTerms;
    expect((await check(rest)).fields).toContain('privacyAndTerms');
    expect((await check({ ...valid, isAdmin: true })).fields).toContain('isAdmin');
  });
});
