import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Pruebas unitarias sobre el módulo "Gestión de pacientes" (server/routes/pacientes.ts).
 * Cubre las rutas agregadas para conectar el frontend real a la API (listado,
 * detalle y actualización), además de la creación ya existente.
 *
 * Dobles de prueba: se sustituyen `pool` (PostgreSQL real) y `requireStaffAuth`
 * (Firebase Admin) por versiones controladas, igual que en ordenes.test.ts.
 */

let currentStaffUser: any = { idUsuario: 1, roleId: 'recepcionista', status: 'activo', nombreCompleto: 'Recepcionista Demo' };

vi.mock('../auth-firebase', () => ({
  requireStaffAuth: (req: any, _res: any, next: any) => {
    req.staffUser = currentStaffUser;
    next();
  },
}));

const queryMock = vi.fn();
vi.mock('../db', () => ({
  pool: { query: (...args: any[]) => queryMock(...args) },
}));

async function buildApp() {
  const { pacientesRouter } = await import('./pacientes');
  const app = express();
  app.use(express.json());
  app.use('/api/pacientes', pacientesRouter);
  return app;
}

beforeEach(() => {
  vi.resetModules();
  queryMock.mockReset();
  currentStaffUser = { idUsuario: 1, roleId: 'recepcionista', status: 'activo', nombreCompleto: 'Recepcionista Demo' };
});

describe('GET /api/pacientes (listado y búsqueda)', () => {
  it('lista pacientes recientes cuando no se envía ?buscar', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id_paciente: 1, nombre_completo: 'María López' }] });
    const app = await buildApp();
    const res = await request(app).get('/api/pacientes');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(queryMock.mock.calls[0][0]).not.toMatch(/ILIKE/);
  });

  it('filtra con ILIKE por nombre o DNI cuando se envía ?buscar', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const app = await buildApp();
    await request(app).get('/api/pacientes?buscar=lopez');
    expect(queryMock.mock.calls[0][0]).toMatch(/ILIKE/);
    expect(queryMock.mock.calls[0][1][0]).toBe('%lopez%');
  });

  it('rechaza con 403 a un rol sin admision_pacientes', async () => {
    // NOTA: 'tecnico_flebotomista' SÍ tiene 'admision_pacientes' en
    // src/shared/permissions.ts (necesita ver datos del paciente al tomar
    // la muestra), así que no sirve para este caso de prueba -habría
    // pasado el middleware y fallado más adelante contra el mock de la
    // base de datos con un 500, no un 403-. 'administrador_ti' es un rol
    // real que efectivamente no tiene ese permiso.
    currentStaffUser.roleId = 'administrador_ti';
    const app = await buildApp();
    const res = await request(app).get('/api/pacientes');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/pacientes/:id', () => {
  it('devuelve 404 si el paciente no existe', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const app = await buildApp();
    const res = await request(app).get('/api/pacientes/999');
    expect(res.status).toBe(404);
  });

  it('devuelve el paciente cuando existe', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id_paciente: 5, nombre_completo: 'Carlos Pérez' }] });
    const app = await buildApp();
    const res = await request(app).get('/api/pacientes/5');
    expect(res.status).toBe(200);
    expect(res.body.nombre_completo).toBe('Carlos Pérez');
  });
});

describe('PATCH /api/pacientes/:id', () => {
  it('rechaza con 400 si no se envía ningún campo válido', async () => {
    const app = await buildApp();
    const res = await request(app).patch('/api/pacientes/5').send({ campoInventado: 'x' });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('actualiza solo los campos permitidos enviados', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id_paciente: 5, telefono_whatsapp: '50212345678' }] });
    const app = await buildApp();
    const res = await request(app).patch('/api/pacientes/5').send({ telefonoWhatsApp: '50212345678' });
    expect(res.status).toBe(200);
    expect(queryMock.mock.calls[0][0]).toMatch(/telefono_whatsapp = \$2/);
  });

  it('devuelve 404 si el id no corresponde a ningún paciente', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const app = await buildApp();
    const res = await request(app).patch('/api/pacientes/999').send({ telefonoWhatsApp: '1' });
    expect(res.status).toBe(404);
  });
});
