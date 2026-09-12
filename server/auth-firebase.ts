/**
 * Verificación de identidad del PERSONAL (Etapa 3).
 *
 * Reemplaza StaffAuthModal.tsx (PIN compartido hardcodeado '1234'/'admin'/...
 * que además arrancaba autenticado por defecto). Ahora cada colaborador
 * inicia sesión con su cuenta individual de Firebase Authentication desde
 * el frontend, y el frontend manda el ID token de Firebase en cada petición
 * como `Authorization: Bearer <token>`. Este middleware lo verifica aquí,
 * en el servidor — nunca confiando en lo que diga el cliente sobre quién es.
 */
import type { Request, Response, NextFunction } from 'express';
import { pool } from './db';
import type { PermissionSubject } from '../src/shared/permissions';

export interface AuthenticatedUser extends PermissionSubject {
  idUsuario: number;
  nombreCompleto: string;
  uid: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staffUser?: AuthenticatedUser;
    }
  }
}

// Se usa `any` a propósito: el admin SDK se carga con require() en tiempo de
// ejecución (ver getFirebaseAdmin) para no forzar su inicialización si el
// entorno de pruebas usa DEV_AUTH_BYPASS_UID, así que no conviene atarse a
// los tipos internos de una versión concreta de firebase-admin.
let firebaseAdminApp: any = null;

function getFirebaseAdmin() {
  if (firebaseAdminApp) return firebaseAdminApp;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const admin = require('firebase-admin');
  const serviceAccountJson = process.env.FIREBASE_ADMIN_CREDENTIALS_JSON;
  if (!serviceAccountJson) {
    throw new Error(
      'Falta FIREBASE_ADMIN_CREDENTIALS_JSON (credencial de servicio de Firebase Admin, generada en ' +
      'Firebase Console > Configuración del proyecto > Cuentas de servicio). No se usan credenciales hardcodeadas.'
    );
  }
  const credential = admin.credential.cert(JSON.parse(serviceAccountJson));
  firebaseAdminApp = admin.initializeApp({ credential });
  return firebaseAdminApp;
}

/**
 * Middleware: exige un ID token de Firebase válido y que ese UID exista
 * como usuario de personal ACTIVO en la tabla `usuario`. Si cualquiera de
 * las dos condiciones falla, corta la petición con 401/403 ANTES de tocar
 * cualquier ruta — es aquí, y no en el frontend, donde se decide el acceso.
 */
export async function requireStaffAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    let uid: string | null = null;

    if (process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_BYPASS_UID && token === 'DEV_BYPASS') {
      // SOLO para pruebas locales sin credenciales reales de Firebase (ver README de la Etapa 3).
      // Nunca disponible si NODE_ENV=production, sin importar qué envíe el cliente.
      uid = process.env.DEV_AUTH_BYPASS_UID;
      console.warn('[AUTH] Usando DEV_AUTH_BYPASS_UID — solo válido fuera de producción.');
    } else {
      if (!token) {
        return res.status(401).json({ error: 'Falta el token de autenticación (Authorization: Bearer <token>).' });
      }
      const admin = getFirebaseAdmin();
      const decoded = await admin.auth().verifyIdToken(token);
      uid = decoded.uid;
    }

    const { rows } = await pool.query(
      `SELECT id_usuario, uid, nombre_completo, rol, estado, permisos_personalizados
       FROM usuario WHERE uid = $1`,
      [uid]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: 'Esta cuenta no está registrada como personal de VACLINIC.' });
    }

    const row = rows[0];
    req.staffUser = {
      idUsuario: row.id_usuario,
      uid: row.uid,
      nombreCompleto: row.nombre_completo,
      roleId: row.rol,
      status: row.estado ? 'activo' : 'inactivo',
      customPermissions: row.permisos_personalizados || {}
    };

    if (req.staffUser.status !== 'activo') {
      return res.status(403).json({ error: 'Usuario inactivo o suspendido.' });
    }

    return next();
  } catch (err: any) {
    console.error('[AUTH] Token inválido o error de verificación:', err?.message);
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}
