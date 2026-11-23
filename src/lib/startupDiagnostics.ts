/** Emit only known operational categories. Exception messages may contain credentials or hostnames. */
export function startupProblemCode(cause: unknown): string {
  if (!(cause instanceof Error)) return 'STARTUP_UNCLASSIFIED';
  switch (cause.message) {
    case 'Customer database migration required: run customer:migrate explicitly':
      return 'CUSTOMER_SCHEMA_MIGRATION_REQUIRED';
    case 'Customer database requires a restricted role without BYPASSRLS':
      return 'CUSTOMER_DATABASE_ROLE_UNSAFE';
    case 'Otro servidor o proceso administrativo utiliza este almacenamiento. Ejecuta el lote mediante su endpoint autenticado o detén ese proceso.':
      return 'STORAGE_WRITER_LOCKED';
    case 'Almacenamiento de administración ilegible. Recupera la copia autorizada antes de iniciar.':
      return 'ADMIN_STORAGE_UNREADABLE';
  }
  switch ((cause as NodeJS.ErrnoException).code) {
    case '42501': return 'DATABASE_PERMISSION_DENIED';
    case '42P01': return 'DATABASE_RELATION_MISSING';
    case '28P01': return 'DATABASE_LOGIN_FAILED';
    case 'ENOSPC': return 'STORAGE_FULL';
    case 'EROFS':
    case 'EACCES': return 'STORAGE_PERMISSION_DENIED';
    case 'EEXIST': return 'STORAGE_FILE_EXISTS';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'ECONNREFUSED':
    case 'ETIMEDOUT': return 'DEPENDENCY_UNREACHABLE';
    default: return 'STARTUP_UNCLASSIFIED';
  }
}
