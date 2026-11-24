import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServiceStatus, ServiceStatusDetails } from '../components/admin-next/ServiceStatus';
import { boltAdmin } from '../components/admin-next/adminClient';
import { operationalMetrics } from '../lib/operationalMetrics';
import { createServiceMonitoring } from '../lib/serviceMonitoring';

test('Inicio consulta al pulsar y distingue el recaudo desconocido del cero confirmado', () => {
  const initial = renderToStaticMarkup(<ServiceStatus token="fixture" />);
  assert.match(initial, /Estado del servicio/);
  assert.match(initial, /Consultar/);
  assert.doesNotMatch(initial, /Efectivo verificado/);
  const report = {service:createServiceMonitoring({env:{}}).snapshot(), operations:operationalMetrics({orders:[],runs:[],demo:false})};
  const empty = renderToStaticMarkup(<ServiceStatusDetails report={report} />);
  assert.match(empty, /Pendiente de configurar/);
  assert.match(empty, /Sin recaudo verificado/);
  assert.match(empty, /Operaciones de prueba/);
  assert.match(empty, /Falta configurar la llave del servidor/);
  assert.match(empty, /Sin consultas desde el arranque/);
  const monitor = createServiceMonitoring({env:{GOOGLE_MAPS_SERVER_API_KEY:'private-fixture'}});
  monitor.recordGeocoding('reverse','DENIED');
  const denied = renderToStaticMarkup(<ServiceStatusDetails report={{...report,service:monitor.snapshot()}} />);
  assert.match(denied, /Google denegó la consulta/);
  assert.doesNotMatch(denied, /private-fixture/);
  const olderServer = renderToStaticMarkup(<ServiceStatusDetails report={{...report,service:{...report.service,geocoding:undefined}}} />);
  assert.match(olderServer,/Operaciones de prueba/);
  assert.doesNotMatch(olderServer,/Última búsqueda por dirección/);
  report.operations.cash.verifiedCollectedCOP = 0;
  report.service.alerts.configured = true;
  const zero = renderToStaticMarkup(<ServiceStatusDetails report={report} />);
  assert.doesNotMatch(zero, /Sin recaudo verificado/);
  assert.match(zero, /\$\s*0/);
  assert.match(zero, /sin envío verificado/);
});

test('el cliente administrativo consulta una ruta fija en el mismo origen', async context => {
  const request = context.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const controller = new AbortController();
  await boltAdmin.observability('fixture', controller.signal);
  const [url, options] = request.mock.calls[0].arguments;
  assert.equal(url, '/api/v1/admin/observability');
  assert.equal(options!.mode, 'same-origin');
  assert.equal(options!.redirect, 'error');
  assert.equal(options!.cache, 'no-store');
  assert.equal(new Headers(options!.headers).get('Authorization'), 'Bearer fixture');
});
