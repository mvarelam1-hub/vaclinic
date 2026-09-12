import { Router } from 'express';
import { pool } from '../db';
import { requireStaffAuth } from '../auth-firebase';
import { requirePermission } from '../permissions-middleware';
import { asyncHandler } from '../asyncHandler';

export const pacientesRouter = Router();
pacientesRouter.use(requireStaffAuth);

// NOTA (alineación con la tesis, capítulo 4): el registro de paciente ya
// NO genera un PIN. El único mecanismo de acceso del paciente a su
// resultado es el código único de consulta que se genera al registrar la
// ORDEN (tabla `codigo_consulta`, ver server/routes/ordenes.ts), tal como
// describe el caso de uso "consultar resultado mediante código único" del
// documento de origen — no hay un segundo factor de PIN en ese diseño.
pacientesRouter.post('/', requirePermission('admision_pacientes'), asyncHandler(async (req, res) => {
  const { nombreCompleto, dni, fechaNacimiento, genero, telefonoWhatsApp, esMenorEdad, nombreEncargadoLegal, telefonoEncargadoLegal } = req.body || {};

  if (!nombreCompleto || !fechaNacimiento || !telefonoWhatsApp) {
    return res.status(400).json({ error: 'nombreCompleto, fechaNacimiento y telefonoWhatsApp son obligatorios.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO paciente (nombre_completo, dni, fecha_nacimiento, genero, telefono_whatsapp,
                              es_menor_edad, nombre_encargado_legal, telefono_encargado_legal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id_paciente, nombre_completo`,
      [nombreCompleto, dni || null, fechaNacimiento, genero || null, telefonoWhatsApp,
        !!esMenorEdad, nombreEncargadoLegal || null, telefonoEncargadoLegal || null]
    );
    return res.status(201).json(rows[0]);
  } catch (err: any) {
    // chk_menor_requiere_encargado u otras reglas de negocio de la migración 0002
    return res.status(400).json({ error: err.message });
  }
}));
