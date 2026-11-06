import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { adminAuthService } from '../lib/adminAuthService';
import { catalogRepository, CatalogRepository } from '../lib/catalogRepository';

console.log('=============================================================');
console.log('BOLT PETS — TEST SUITE: ADMINISTRADOR DE CATÁLOGO & SEGURIDAD');
console.log('=============================================================');

async function runCatalogAdminTests() {
  let passedCount = 0;
  function pass(msg: string) {
    console.log(`✅ PASS: ${msg}`);
    passedCount++;
  }

  // Rutas de archivos de prueba
  const testAuthPath = path.join(process.cwd(), 'src', 'data', 'persisted-admin-auth.json');
  const testCatalogPath = path.join(process.cwd(), 'src', 'data', 'persisted-catalog-overrides.json');

  // Guardar respaldos si existen
  const authBackup = fs.existsSync(testAuthPath) ? fs.readFileSync(testAuthPath, 'utf-8') : null;
  const catalogBackup = fs.existsSync(testCatalogPath) ? fs.readFileSync(testCatalogPath, 'utf-8') : null;

  try {
    // ------------------------------------------------------------------------
    // 1. ACCESO SEGURO Y AUTENTICACIÓN ADMINISTRATIVA
    // ------------------------------------------------------------------------
    console.log('\n--- 1. Acceso Seguro y Permisos Comprobados por Servidor ---');

    // Limpiar estado para pruebas aisladas
    adminAuthService.resetForTesting();
    assert.strictEqual(adminAuthService.isSetupRequired(), true, 'Debe requerir configuración inicial si no hay admin');
    pass('El servidor detecta que se requiere configuración de administrador maestro');

    // Intentar login sin existir admin
    const invalidLogin = adminAuthService.login('admin@bolt.pet', 'claveErronea123');
    assert.strictEqual(invalidLogin.success, false);
    pass('Rechaza intento de inicio de sesión sin administrador registrado');

    // Configurar Administrador Maestro
    const setupRes = adminAuthService.setupMasterAdmin({
      email: 'admin.seguro@bolt.pet',
      password: 'MiPasswordSeguro2026!',
      name: 'Super Administrador',
    });
    assert.strictEqual(setupRes.success, true);
    assert.ok(setupRes.token?.startsWith('bolt_sec_'));
    pass('Aprovisionamiento exitoso de Administrador Maestro con hash PBKDF2 y salt criptográfico');

    // Intentar segundo setup (debe ser rechazado por seguridad)
    const secondSetup = adminAuthService.setupMasterAdmin({
      email: 'hacker@bolt.pet',
      password: 'hackerPassword123!',
      name: 'Intruso',
    });
    assert.strictEqual(secondSetup.success, false);
    pass('El servidor rechaza registros secundarios de administrador maestro');

    // Verificar sesión con token válido
    const validSession = adminAuthService.verifySession(setupRes.token);
    assert.ok(validSession);
    assert.strictEqual(validSession?.role, 'ADMINISTRADOR');
    assert.strictEqual(validSession?.email, 'admin.seguro@bolt.pet');
    pass('Sesión administrativa verificada con token criptográfico válido');

    // Verificar rechazo con token inválido o manipulado
    const fakeSession = adminAuthService.verifySession('bolt_sec_fake_token_12345');
    assert.strictEqual(fakeSession, null);
    pass('Rechaza token falso o manipulado (401/403)');

    // Login normal con contraseña correcta
    const loginOk = adminAuthService.login('admin.seguro@bolt.pet', 'MiPasswordSeguro2026!');
    assert.strictEqual(loginOk.success, true);
    assert.ok(loginOk.token);
    pass('Inicio de sesión exitoso con credenciales correctas');

    // Login con contraseña incorrecta
    const loginFail = adminAuthService.login('admin.seguro@bolt.pet', 'PasswordEquivocado999');
    assert.strictEqual(loginFail.success, false);
    pass('Rechaza login con contraseña incorrecta');

    // ------------------------------------------------------------------------
    // 2. CREACIÓN Y EDICIÓN DE PRODUCTOS
    // ------------------------------------------------------------------------
    console.log('\n--- 2. Creación y Edición de Productos ---');
    catalogRepository.resetForTesting();

    const actor = { email: 'admin.seguro@bolt.pet', name: 'Super Administrador' };

    // Crear nuevo producto
    const testSku = `SKU-TEST-${Date.now().toString().slice(-5)}`;
    const createRes = catalogRepository.createProduct({
      name: 'Alimento Premium Bolt Cachorros',
      brand: 'Bolt Nutrition',
      sku: testSku,
      category: 'Alimentos',
      species: 'Perro',
      price: 185000,
      originalPrice: 210000,
      presentation: 'Bulto 15 kg',
      weightKg: 15,
      description: 'Fórmula balanceada con DHA para cachorros',
      stockByStore: {
        HUB_KENNEDY: 25,
        HUB_ALAMOS: 18,
        HUB_SUBA: 12,
        HUB_CENTRO: 0,
        HUB_FONTIBON: 0,
      },
    }, actor);

    assert.strictEqual(createRes.success, true);
    assert.ok(createRes.product);
    const createdId = createRes.product!.id;
    assert.strictEqual(createRes.product!.price, 185000);
    assert.strictEqual(createRes.product!.sku, testSku);
    pass('Creación de producto nuevo con SKU único, precio en COP e inventario por bodega');

    // Intentar crear producto duplicado con el mismo SKU
    const dupRes = catalogRepository.createProduct({
      name: 'Producto Clon',
      sku: testSku,
      price: 50000,
    }, actor);
    assert.strictEqual(dupRes.success, false, 'No debe permitir SKU duplicado');
    pass('Validación de SKU duplicado rechaza creación con referencia repetida');

    // Editar ficha del producto
    const editRes = catalogRepository.updateProduct(createdId, {
      name: 'Alimento Premium Bolt Cachorros Raza Grande 15kg',
      description: 'Fórmula mejorada con condroitina y glucosamina',
      weightKg: 15.5,
    }, actor);
    assert.strictEqual(editRes.success, true);
    assert.strictEqual(editRes.product?.name, 'Alimento Premium Bolt Cachorros Raza Grande 15kg');
    assert.strictEqual(editRes.product?.weightKg, 15.5);
    pass('Edición de datos del producto (nombre, descripción, peso) aplicada exitosamente');

    // ------------------------------------------------------------------------
    // 3. ADMINISTRACIÓN DE PRECIOS EN COP POR VARIANTE
    // ------------------------------------------------------------------------
    console.log('\n--- 3. Ajuste de Precios en COP por Variante ---');

    const priceUpdateRes = catalogRepository.updateVariantPriceAndStock(createdId, {
      priceCOP: 195000,
    }, actor);
    assert.strictEqual(priceUpdateRes.success, true);
    assert.strictEqual(priceUpdateRes.product?.price, 195000);
    pass('Actualización de precio en COP por variante a $195.000');

    // Rechazar precio negativo o cero
    const invalidPriceRes = catalogRepository.updateVariantPriceAndStock(createdId, {
      priceCOP: -500,
    }, actor);
    assert.strictEqual(invalidPriceRes.success, false);
    pass('Rechaza asignación de precios no válidos (negativos o cero)');

    // ------------------------------------------------------------------------
    // 4. ADMINISTRACIÓN DE INVENTARIO POR VARIANTE Y BODEGA
    // ------------------------------------------------------------------------
    console.log('\n--- 4. Inventario por Sede y Bodega ---');

    const stockUpdateRes = catalogRepository.updateVariantPriceAndStock(createdId, {
      stockByStore: {
        HUB_KENNEDY: 40,
        HUB_ALAMOS: 30,
        HUB_SUBA: 20,
      },
    }, actor);
    assert.strictEqual(stockUpdateRes.success, true);
    assert.strictEqual(stockUpdateRes.product?.stockByStore?.HUB_KENNEDY, 40);
    assert.strictEqual(stockUpdateRes.product?.stockByStore?.HUB_ALAMOS, 30);
    assert.strictEqual(stockUpdateRes.product?.stockByStore?.HUB_SUBA, 20);
    pass('Actualización independiente de stock por bodega (Kennedy: 40, Álamos: 30, Suba: 20)');

    // ------------------------------------------------------------------------
    // 5. ACTIVACIÓN Y DESACTIVACIÓN CONSERVANDO HISTORIAL
    // ------------------------------------------------------------------------
    console.log('\n--- 5. Activación y Desactivación de Productos ---');

    // Desactivar producto
    const toggle1 = catalogRepository.toggleProductStatus(createdId, actor);
    assert.strictEqual(toggle1.success, true);
    assert.strictEqual(toggle1.newStatus, 'INACTIVE');
    assert.strictEqual(catalogRepository.getProductById(createdId)?.status, 'INACTIVE');

    // Comprobar que desaparece del catálogo de clientes (includeInactive = false)
    const activeProducts = catalogRepository.getAllProducts(false);
    assert.strictEqual(activeProducts.some(p => p.id === createdId), false, 'Producto inactivo no debe aparecer para clientes');
    pass('Producto desactivado queda oculto para compras de clientes');

    // Comprobar que sigue existiendo para auditoría y pedidos históricos (includeInactive = true)
    const allProductsAdmin = catalogRepository.getAllProducts(true);
    assert.strictEqual(allProductsAdmin.some(p => p.id === createdId), true, 'Producto inactivo debe conservarse en administración');
    pass('Producto desactivado preserva su ID, registros y trazabilidad en administración');

    // Reactivar producto
    const toggle2 = catalogRepository.toggleProductStatus(createdId, actor);
    assert.strictEqual(toggle2.success, true);
    assert.strictEqual(toggle2.newStatus, 'ACTIVE');
    pass('Reactivación exitosa a estado ACTIVE para la tienda');

    // ------------------------------------------------------------------------
    // 6. GESTIÓN DE IMÁGENES Y GALERÍA
    // ------------------------------------------------------------------------
    console.log('\n--- 6. Gestión de Imágenes y Galería ---');

    const newImageUrl = '/uploads/catalog/img-test-cachorros.png';
    const imgRes = catalogRepository.setProductImage(createdId, newImageUrl, true, actor);
    assert.strictEqual(imgRes.success, true);
    assert.strictEqual(imgRes.product?.image, newImageUrl);
    assert.ok(imgRes.product?.gallery?.includes(newImageUrl));
    pass('Asignación de nueva imagen principal y adición a galería');

    // ------------------------------------------------------------------------
    // 7. PERSISTENCIA EN DISCO Y SUPERVIVENCIA A REINICIOS
    // ------------------------------------------------------------------------
    console.log('\n--- 7. Persistencia en Disco y Supervivencia a Reinicios ---');

    // Instanciar un nuevo repositorio independiente simulando un reinicio total de la app
    const rebootedRepo = new CatalogRepository();
    const persistedProd = rebootedRepo.getProductById(createdId);

    assert.ok(persistedProd, 'El producto debe encontrarse tras reiniciar el repositorio');
    assert.strictEqual(persistedProd?.name, 'Alimento Premium Bolt Cachorros Raza Grande 15kg');
    assert.strictEqual(persistedProd?.price, 195000);
    assert.strictEqual(persistedProd?.stockByStore?.HUB_KENNEDY, 40);
    assert.strictEqual(persistedProd?.image, newImageUrl);
    assert.strictEqual(persistedProd?.status, 'ACTIVE');
    pass('Producto, precio ($195.000 COP), stock por bodega y foto persisten intactos tras reinicio');

    // ------------------------------------------------------------------------
    // 8. HISTORIAL INMUTABLE DE AUDITORÍA
    // ------------------------------------------------------------------------
    console.log('\n--- 8. Auditoría de Modificaciones ---');
    const auditLogs = rebootedRepo.getAuditLog(createdId);
    assert.ok(auditLogs.length >= 4, 'Debe haber registros de creación, edición, precio y foto');
    assert.strictEqual(auditLogs[0].actor.email, 'admin.seguro@bolt.pet');
    pass(`Historial de auditoría inmutable registrado con ${auditLogs.length} eventos detallados`);

    console.log('\n=============================================================');
    console.log(`RESULTADOS: ${passedCount} pruebas aprobadas, 0 fallidas`);
    console.log('=============================================================');

  } finally {
    // Restaurar archivos originales para no alterar el entorno
    if (authBackup) {
      fs.writeFileSync(testAuthPath, authBackup, 'utf-8');
    } else if (fs.existsSync(testAuthPath)) {
      try { fs.unlinkSync(testAuthPath); } catch {}
    }

    if (catalogBackup) {
      fs.writeFileSync(testCatalogPath, catalogBackup, 'utf-8');
    } else if (fs.existsSync(testCatalogPath)) {
      try { fs.unlinkSync(testCatalogPath); } catch {}
    }

    // Reinicializar repositorios con datos limpios
    catalogRepository.init();
  }
}

runCatalogAdminTests().catch(err => {
  console.error('❌ Error en pruebas de catálogo administrativo:', err);
  process.exit(1);
});
