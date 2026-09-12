/**
 * Ciclo de vida de un resultado: Borrador -> Validado -> Publicado -> (En corrección).
 * Cada transición aquí:
 *  1) exige el permiso correspondiente REVALIDADO en el servidor (no solo
 *     oculto en el frontend), y
 *  2) corre dentro de withAuditContext() para que el trigger de la Etapa 2
 *     (trg_auditoria_resultado) registre quién y por qué en historial_auditoria.
 */
import { Router } from 'express';
import { pool, withAuditContext } from '../db';
import { requireStaffAuth } from '../auth-firebase';
import { requirePermission } from '../permissions-middleware';
import { hasPermission } from '../../src/shared/permissions';
import { asyncHandler } from '../asyncHandler';

export const resultadosRouter = Router();
resultadosRouter.use(requireStaffAuth);

// Transiciones de estado permitidas explícitamente (requisito de la sección 4
// del diagnóstico: "define las transiciones permitidas y quién puede ejecutarlas").
const TRANSICIONES: Record<string, { destino: string; permiso: string }> = {
  validar: { destino: 'Validado', permiso: 'validacion_firma_digital' },
  publicar: { destino: 'Publicado', permiso: 'validacion_publicacion' },
  corregir: { destino: 'En correccion', permiso: 'validacion_firma_digital' }
};

resultadosRouter.patch('/:id/:accion', asyncHandler(async (req, res) => {
  try {
    const { id, accion } = req.params;
    const transicion = TRANSICIONES[accion];
    if (!transicion) {
      return res.status(400).json({ error: `Acción "${accion}" no reconocida. Usa: ${Object.keys(TRANSICIONES).join(', ')}.` });
    }

    const staffUser = req.staffUser!;
    if (!hasPermission(staffUser, transicion.permiso)) {
      return res.status(403).json({ error: `El rol "${staffUser.roleId}" no tiene el permiso "${transicion.permiso}".` });
    }

    const idResultado = Number(id);
    const { motivo, nuevoValor } = req.body || {};

    const { rows } = await pool.query('SELECT estado, valor_capturado FROM resultado WHERE id_resultado = $1', [idResultado]);
    if (rows.length === 0) return res.status(404).json({ error: 'Resultado no encontrado.' });
    const actual = rows[0];

    if (accion === 'publicar' && actual.estado !== 'Validado') {
      return res.status(409).json({ error: `No se puede publicar un resultado en estado "${actual.estado}". Debe estar Validado primero.` });
    }
    if (accion === 'corregir' && actual.estado !== 'Publicado') {
      return res.status(409).json({ error: 'Solo se puede "corregir" un resultado ya Publicado. Si aún no se publicó, edítalo directamente.' });
    }
    if (accion === 'corregir' && !motivo) {
      return res.status(400).json({ error: 'Una corrección post-publicación exige indicar el motivo (queda en el historial).' });
    }

    await withAuditContext(
      { userId: staffUser.idUsuario, motivo: motivo || `Transición de estado: ${actual.estado} → ${transicion.destino}` },
      async (client) => {
        if (accion === 'corregir' && nuevoValor !== undefined) {
          await client.query(
            `UPDATE resultado SET estado = $1, valor_capturado = $2 WHERE id_resultado = $3`,
            [transicion.destino, String(nuevoValor), idResultado]
          );
        } else if (accion === 'validar') {
          await client.query(
            `UPDATE resultado SET estado = $1, validado_por_nombre = $2 WHERE id_resultado = $3`,
            [transicion.destino, staffUser.nombreCompleto, idResultado]
          );
        } else if (accion === 'publicar') {
          await client.query(
            `UPDATE resultado SET estado = $1, fecha_publicacion = NOW() WHERE id_resultado = $2`,
            [transicion.destino, idResultado]
          );
        } else {
          await client.query(`UPDATE resultado SET estado = $1 WHERE id_resultado = $2`, [transicion.destino, idResultado]);
        }
      }
    );

    return res.json({ ok: true, idResultado, estadoAnterior: actual.estado, estadoNuevo: transicion.destino });
  } catch (err: any) {
    console.error('[resultados] Error al aplicar transición:', err.message); // sin PII del paciente en el log
    return res.status(500).json({ error: 'No se pudo aplicar la transición.' });
  }
}));

// Historial de versiones de un resultado (requisito: "una corrección debe
// generar una nueva versión... consultable"), usando fn_historial_resultado
// de la migración 0004.
resultadosRouter.get('/:id/historial', requirePermission('admin_bitacora_auditoria'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM fn_historial_resultado($1)', [Number(req.params.id)]);
  return res.json({ idResultado: Number(req.params.id), versiones: rows });
}));
