import { Router } from 'express';
import { pool } from '../db';
import { requireStaffAuth } from '../auth-firebase';
import { requirePermission } from '../permissions-middleware';
import { asyncHandler } from '../asyncHandler';

export const ordenesRouter = Router();
ordenesRouter.use(requireStaffAuth);

ordenesRouter.post('/', requirePermission('admision_crear_ordenes'), asyncHandler(async (req, res) => {
  const { idPaciente, examenesIds } = req.body || {};
  if (!idPaciente || !Array.isArray(examenesIds) || examenesIds.length === 0) {
    return res.status(400).json({ error: 'idPaciente y examenesIds (arreglo no vacío) son obligatorios.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const numeroOrden = `ORD-${Date.now()}`;
    const { rows: ordenRows } = await client.query(
      `INSERT INTO orden (numero_orden, id_paciente, id_recepcionista, estado)
       VALUES ($1, $2, $3, 'Registrada') RETURNING id_orden, numero_orden`,
      [numeroOrden, idPaciente, req.staffUser!.idUsuario]
    );
    const idOrden = ordenRows[0].id_orden;

    for (const idExamen of examenesIds) {
      const { rows: examRows } = await client.query('SELECT precio FROM examen WHERE id_examen = $1', [idExamen]);
      if (examRows.length === 0) throw new Error(`Examen ${idExamen} no existe en el catálogo.`);
      await client.query(
        `INSERT INTO detalle_orden (id_orden, id_examen, precio_unitario) VALUES ($1, $2, $3)`,
        [idOrden, idExamen, examRows[0].precio]
      );
    }

    await client.query('COMMIT');
    return res.status(201).json(ordenRows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
}));

// Alimenta directamente el dashboard con la vista de la Etapa 2 — el
// backend no reimplementa la lógica de "qué está pendiente", la reutiliza.
ordenesRouter.get('/pendientes-validacion', requirePermission('validacion_redaccion'), asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM vw_ordenes_pendientes_validacion ORDER BY fecha_registro ASC');
  return res.json(rows);
}));

ordenesRouter.get('/resultados-criticos', requirePermission('analizadores_panico'), asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM vw_resultados_criticos');
  return res.json(rows);
}));
