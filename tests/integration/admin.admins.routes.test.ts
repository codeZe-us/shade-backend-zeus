import { beforeEach } from '@jest/globals';
import { mockReset } from 'jest-mock-extended';
import jwt from 'jsonwebtoken';
import request from 'supertest';

const { default: prismaMock } = (await import('../../src/config/prisma.js')) as any;
const { environment } = await import('../../src/config/environment.js');
const { default: app } = await import('../../src/app.js');

const admin = {
  id: 'admin-uuid',
  address: 'GADMINADDRESS',
  name: 'Plain Admin',
  active: true,
  isSuperAdmin: false,
  createdBy: null,
  createdAt: new Date('2026-06-27T12:00:00.000Z'),
  updatedAt: new Date('2026-06-27T12:00:00.000Z'),
};

const superAdmin = {
  ...admin,
  id: 'superadmin-uuid',
  address: 'GSUPERADMINADDRESS',
  name: 'Super Admin',
  isSuperAdmin: true,
};

// A real, structurally valid Ed25519 public key — StrKey verifies the checksum.
const NEW_ADMIN_ADDRESS = 'GA6HCMBLTZS5VYYBCATRBRZ3BZJMAFUDKYYF6AH6MVCMGWMRDNSWJPIH';

const createdAdmin = {
  id: 'new-admin-uuid',
  address: NEW_ADMIN_ADDRESS,
  name: 'Jane Doe',
  active: true,
  isSuperAdmin: false,
  createdBy: superAdmin.id,
  createdAt: new Date('2026-06-27T12:00:00.000Z'),
  updatedAt: new Date('2026-06-27T12:00:00.000Z'),
};

const signToken = (subject: string, address: string) =>
  jwt.sign({ sub: subject, address, type: 'admin' }, environment.jwtSecret, { expiresIn: '15m' });

const adminToken = signToken(admin.id, admin.address);
const superAdminToken = signToken(superAdmin.id, superAdmin.address);

describe('POST /api/v1/admin/admins', () => {
  beforeEach(() => {
    mockReset(prismaMock);
    // authenticateAdmin resolves the acting admin by the token's sub.
    prismaMock.admin.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === superAdmin.id ? superAdmin : null),
    );
    // The admin row and its audit row are written in one transaction, so the
    // interactive callback has to run against the same mock client.
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
  });

  test('returns 401 when unauthenticated', async () => {
    const response = await request(app)
      .post('/api/v1/admin/admins')
      .send({ address: NEW_ADMIN_ADDRESS, name: 'Jane Doe' });

    expect(response.status).toBe(401);
    expect(prismaMock.admin.create).not.toHaveBeenCalled();
  });

  test('returns 403 for an authenticated admin that is not a superadmin', async () => {
    prismaMock.admin.findUnique.mockResolvedValue(admin);

    const response = await request(app)
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ address: NEW_ADMIN_ADDRESS, name: 'Jane Doe' });

    expect(response.status).toBe(403);
    expect(prismaMock.admin.create).not.toHaveBeenCalled();
    expect(prismaMock.adminLog.create).not.toHaveBeenCalled();
  });

  test('creates the admin, defaults isSuperAdmin to false, and logs the action once', async () => {
    prismaMock.admin.create.mockResolvedValue(createdAdmin);

    const response = await request(app)
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ address: NEW_ADMIN_ADDRESS, name: 'Jane Doe' });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe('new-admin-uuid');
    expect(response.body.isSuperAdmin).toBe(false);
    // createdBy is the acting superadmin, not the new row itself.
    expect(response.body.createdBy).toBe(superAdmin.id);
    expect(prismaMock.admin.create).toHaveBeenCalledWith({
      data: {
        address: NEW_ADMIN_ADDRESS,
        name: 'Jane Doe',
        isSuperAdmin: false,
        active: true,
        createdBy: superAdmin.id,
      },
    });
    expect(prismaMock.adminLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.adminLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'admin.created',
        actorType: 'ADMIN',
        actorId: superAdmin.id,
        actorLabel: superAdmin.address,
        targetType: 'Admin',
        targetId: createdAdmin.id,
      }),
    });
  });

  test('grants superadmin when explicitly requested', async () => {
    prismaMock.admin.create.mockResolvedValue({ ...createdAdmin, isSuperAdmin: true });

    const response = await request(app)
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ address: NEW_ADMIN_ADDRESS, name: 'Jane Doe', isSuperAdmin: true });

    expect(response.status).toBe(201);
    expect(response.body.isSuperAdmin).toBe(true);
    expect(prismaMock.admin.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isSuperAdmin: true }),
    });
  });

  test('returns 409 for an address that already has an admin row, creating nothing', async () => {
    prismaMock.admin.findUnique.mockImplementation(({ where }: any) => {
      if (where.id === superAdmin.id) return Promise.resolve(superAdmin);
      if (where.address === NEW_ADMIN_ADDRESS) return Promise.resolve(createdAdmin);
      return Promise.resolve(null);
    });

    const response = await request(app)
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ address: NEW_ADMIN_ADDRESS, name: 'Jane Doe' });

    expect(response.status).toBe(409);
    expect(prismaMock.admin.create).not.toHaveBeenCalled();
    expect(prismaMock.admin.update).not.toHaveBeenCalled();
    expect(prismaMock.adminLog.create).not.toHaveBeenCalled();
  });

  test('returns 409 when a concurrent request wins the unique address', async () => {
    // Both requests pass the findUnique pre-check; only one create survives the
    // unique constraint on Admin.address.
    prismaMock.admin.create.mockRejectedValue({ code: 'P2002', meta: { target: ['address'] } });

    const response = await request(app)
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ address: NEW_ADMIN_ADDRESS, name: 'Jane Doe' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('An admin already exists for this address');
    expect(prismaMock.adminLog.create).not.toHaveBeenCalled();
  });

  test('fails the request when the audit row cannot be written', async () => {
    prismaMock.admin.create.mockResolvedValue(createdAdmin);
    prismaMock.adminLog.create.mockRejectedValue(new Error('audit write failed'));

    const response = await request(app)
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ address: NEW_ADMIN_ADDRESS, name: 'Jane Doe' });

    // A privileged account must never be created without an audit trail, so the
    // transaction rolls back and the caller sees a 500 rather than a 201.
    expect(response.status).toBe(500);
  });

  test('returns 400 for a null isSuperAdmin', async () => {
    const response = await request(app)
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ address: NEW_ADMIN_ADDRESS, name: 'Jane Doe', isSuperAdmin: null });

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('isSuperAdmin');
    expect(prismaMock.admin.create).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid Stellar address', async () => {
    const response = await request(app)
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ address: 'not-a-stellar-key', name: 'Jane Doe' });

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('address');
    expect(prismaMock.admin.create).not.toHaveBeenCalled();
  });

  test('returns 400 for a missing name', async () => {
    const response = await request(app)
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ address: NEW_ADMIN_ADDRESS });

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('name');
    expect(prismaMock.admin.create).not.toHaveBeenCalled();
  });

  test('returns 400 for a non-boolean isSuperAdmin rather than escalating', async () => {
    const response = await request(app)
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ address: NEW_ADMIN_ADDRESS, name: 'Jane Doe', isSuperAdmin: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('isSuperAdmin');
    expect(prismaMock.admin.create).not.toHaveBeenCalled();
  });

  test('never exposes a secret or keypair in the response', async () => {
    prismaMock.admin.create.mockResolvedValue(createdAdmin);

    const response = await request(app)
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ address: NEW_ADMIN_ADDRESS, name: 'Jane Doe' });

    expect(response.status).toBe(201);
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/secret/i);
    expect(body).not.toMatch(/privateKey/i);
    expect(response.body).toEqual({
      id: createdAdmin.id,
      address: createdAdmin.address,
      name: createdAdmin.name,
      active: createdAdmin.active,
      isSuperAdmin: createdAdmin.isSuperAdmin,
      createdBy: superAdmin.id,
      createdAt: createdAdmin.createdAt.toISOString(),
      updatedAt: createdAdmin.updatedAt.toISOString(),
    });
  });
});
