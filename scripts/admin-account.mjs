import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import readline from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { tsImport } from 'tsx/esm/api';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const { AdminRepository } = await tsImport(pathToFileURL(path.join(root, 'src/lib/adminRepository.ts')).href, import.meta.url);
const { localCatalogService } = await tsImport(pathToFileURL(path.join(root, 'src/lib/localCatalogService.ts')).href, import.meta.url);

async function ask(label) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await input.question(label)).trim(); } finally { input.close(); }
}

async function secret(label) {
  if (!process.stdin.isTTY) throw new Error('Ejecuta este comando en una terminal interactiva o configura BOLT_ADMIN_PASSWORD de forma privada.');
  process.stdout.write(label);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function cleanup() {
      process.stdin.removeListener('keypress', keypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    }
    function keypress(character, key = {}) {
      if (key.ctrl && key.name === 'c') { cleanup(); reject(new Error('Operación cancelada.')); return; }
      if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(value); return; }
      if (key.name === 'backspace') { value = [...value].slice(0, -1).join(''); return; }
      if (character && !key.ctrl && !key.meta && !/\p{Cc}/u.test(character)) value += character;
    }
    process.stdin.on('keypress', keypress);
  });
}

let repository;
try {
  const command = process.argv[2] || 'create';
  if (!['create', 'reset-password', 'backup'].includes(command)) throw new Error('Usa create, reset-password o backup.');
  const products = localCatalogService.getAllGroupedProducts();
  const stores = localCatalogService.getStores();
  if (!products.length || !stores.length) throw new Error('No se encontró el catálogo base de Bolt Pets; no se crea una base de datos vacía.');
  repository = new AdminRepository({ products, stores });
  if (command === 'backup') {
    const filename = repository.backup();
    console.log(`Copia privada creada: ${filename}`);
  } else {
    const username = process.env.BOLT_ADMIN_USERNAME || await ask('Usuario administrativo: ');
    let password = process.env.BOLT_ADMIN_PASSWORD;
    if (!password) {
      password = await secret('Contraseña (mínimo 12 caracteres, no se muestra): ');
      const repeated = await secret('Repite la contraseña: ');
      if (password !== repeated) throw new Error('Las contraseñas no coinciden.');
    }
    if (command === 'create') {
      const displayName = process.env.BOLT_ADMIN_DISPLAY_NAME || username;
      repository.createAdministrator(username, password, displayName);
      console.log('Administrador creado. Entra a http://127.0.0.1:4327/operacion con el usuario y la contraseña que elegiste.');
    } else {
      repository.resetPassword(username, password);
      console.log('Contraseña restablecida. Las sesiones anteriores quedaron cerradas.');
    }
    password = undefined;
    delete process.env.BOLT_ADMIN_PASSWORD;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se pudo completar la operación administrativa.');
  process.exitCode = 1;
} finally {
  repository?.close();
}
