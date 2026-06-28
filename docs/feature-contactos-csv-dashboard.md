# Feature Proposal: Contactos persistentes + metricas por grupo/cliente + dashboard

Fecha: 2026-02-17
Proyecto: `message-sender`

## 1) Objetivo del feature

Agregar un flujo donde el CSV no solo dispare envios, sino que tambien:

1. Registre contactos en base de datos (persistente) desde CSV y tambien manualmente.
2. Guarde atributos del contacto: `nombre`, `tratamiento`, `grupo`.
3. Relacione toda la actividad al usuario autenticado por Keycloak (`req.auth.sub`).
4. Permita medir por usuario:
   - cuantos mensajes se enviaron,
   - cuantos fallaron,
   - por grupo,
   - por contacto/cliente.
5. Habilite un dashboard real con graficos (linea de tiempo + torta).
6. Muestre claramente el acumulado mensual de mensajes enviados (mes actual) y tendencia mensual historica.

## 2) Estado actual del proyecto (analisis)

### Backend

- El endpoint principal de envio es `POST /send-messages` en `src/routes.js:140`.
- El CSV se parsea en `loadNumbersFromCSV()` (`src/utils.js:99`).
- El parser ya lee:
  - columna 1: numero,
  - columna 2: `tratamiento`,
  - columna 3: `nombre`.
    (ver `src/utils.js:118` a `src/utils.js:126`).
- No existe persistencia historica en una DB relacional; hoy se usa Redis para estado de cola/progreso (`src/queueRedis.js`).
- El estado de campaña en Redis es temporal (con TTL), y se limpia al terminar/cancelar (`src/queueRedis.js:764` a `src/queueRedis.js:767`).
- El `userId` ya existe y viene de Keycloak (`req.auth.sub`), y se usa para aislar sesiones/campañas (`src/sessionManager.js:75` a `src/sessionManager.js:77`).
- No existe hoy un CRUD de contactos para alta/edicion manual.

### Frontend

- La pantalla de envio ya muestra progreso y tabla de resultados.
- Existe una seccion `analytics`, pero actualmente es placeholder estatico en `public/index.html:647`.
- El boton/tab de analytics esta comentado en navegacion (`public/index.html:144`).

### Conclusiones del estado actual

1. La base para multi-tenant por usuario ya existe (Keycloak sub).
2. El CSV ya soporta variables personalizadas, pero no `grupo`.
3. Falta una capa de datos historica para reporting real.
4. Redis debe seguir para cola/tiempo real, pero no alcanza para BI/metricas historicas.

## 3) Propuesta tecnica (arquitectura recomendada)

Mantener arquitectura hibrida:

- Redis/BullMQ: ejecucion de campaña, progreso en vivo, locking.
- PostgreSQL: persistencia de contactos, campañas, resultados, agregaciones para dashboard.

Por que PostgreSQL:

- modelo relacional claro para contactos-campañas-eventos,
- consultas analiticas mas simples y estables (GROUP BY, series por tiempo, filtros por grupo),
- fuerte consistencia para historico de negocio.

## 4) Modelo de datos propuesto

## 4.1 Tablas base

### `app_user`

- `id` (uuid pk)
- `keycloak_user_id` (text unique, index) <-- `req.auth.sub`
- `email` (text null)
- `display_name` (text null)
- `created_at`, `updated_at`

### `contact_group`

- `id` (uuid pk)
- `user_id` (fk app_user.id, index)
- `name` (text)
- `created_at`, `updated_at`
- unique: (`user_id`, `name`)

### `contact`

- `id` (uuid pk)
- `user_id` (fk app_user.id, index)
- `phone_e164` (text) <-- ej. `595972117231`
- `nombre` (text null)
- `tratamiento` (text null)
- `source` (text, default `csv`, valores: `csv` | `manual`)
- `created_at`, `updated_at`, `last_seen_at`
- unique: (`user_id`, `phone_e164`)

### `contact_group_membership`

- `id` (uuid pk)
- `user_id` (fk app_user.id, index)
- `contact_id` (fk contact.id, index)
- `group_id` (fk contact_group.id, index)
- `is_active` (bool default true)
- `created_at`, `updated_at`
- unique: (`contact_id`, `group_id`)

## 4.2 Tablas de campañas/envios

### `campaign`

- `id` (uuid pk)
- `user_id` (fk app_user.id, index)
- `name` (text) <-- nombre de campaña (nuevo en UI)
- `status` (enum: queued, running, completed, canceled, failed)
- `total_recipients` (int)
- `sent_count` (int)
- `error_count` (int)
- `template_count` (int)
- `started_at`, `finished_at`
- `created_at`, `updated_at`

### `campaign_recipient`

- `id` (uuid pk)
- `campaign_id` (fk campaign.id, index)
- `user_id` (fk app_user.id, index)
- `contact_id` (fk contact.id, index)
- `phone_snapshot` (text)
- `group_snapshot` (text null) <-- para historico aunque cambie el grupo luego
- `template_index` (int null)
- `status` (enum: queued, sending, sent, error, canceled)
- `attempts` (int default 0)
- `error_message` (text null)
- `sent_at` (timestamp null)
- `created_at`, `updated_at`
- unique recomendado: (`campaign_id`, `contact_id`)

### `campaign_event` (timeline)

- `id` (bigserial pk)
- `campaign_id` (fk campaign.id, index)
- `user_id` (fk app_user.id, index)
- `recipient_id` (fk campaign_recipient.id, null)
- `event_type` (enum: enqueue, start, message_sending, message_sent, message_error, canceled, completed)
- `payload` (jsonb)
- `created_at` (timestamp, index)

## 4.3 Indices clave

- `contact(user_id, phone_e164)` unique
- `campaign(user_id, created_at desc)`
- `campaign_recipient(user_id, status, updated_at desc)`
- `campaign_event(user_id, created_at desc)`
- `contact_group(user_id, name)` unique

## 5) Contrato CSV propuesto

Soportar dos modos:

1. Sin headers (compatibilidad con lo actual):
   `numero,tratamiento,nombre,grupo`
2. Con headers (recomendado):
   `numero,nombre,tratamiento,grupo`

Reglas:

- `numero` obligatorio.
- `grupo` opcional (si vacio: `Sin grupo` o null, segun decision de negocio).
- Permitir grupos multiples separados por `;` (opcional fase 2).

Ejemplo recomendado:

```csv
numero,nombre,tratamiento,grupo
595972117231,Carlos,Senor,Premium
595976947110,Ana,Senora,Reactivacion
595984123456,Jose,Doctor,Premium
```

## 6) Cambios backend (paso a paso)

## Fase 1: Fundacion de persistencia

1. Agregar PostgreSQL al proyecto (docker-compose + env + cliente DB).
2. Crear carpeta de migraciones SQL.
3. Crear tablas del modelo anterior.
4. Crear modulo `src/db/` con pool y helpers de transaccion.

Aceptacion:

- migraciones corren en local/CI sin errores,
- healthcheck DB disponible (`/ready` extendido opcional).

## Fase 2: Importacion de contactos desde CSV

1. Extender parser CSV (`src/utils.js`) para mapear tambien `grupo`.
2. Crear servicio `contactImportService`:
   - resuelve/crea `app_user` por `keycloak_user_id`,
   - upsert de contactos por (`user_id`, `phone`),
   - crea/actualiza grupo y membership.
3. Guardar resultado de importacion:
   - insertados, actualizados, duplicados, invalidos.

Aceptacion:

- cada fila valida del CSV queda persistida en DB,
- no hay fuga entre usuarios (tenant isolation).

## Fase 2.1: Gestion manual de contactos

1. Crear endpoints CRUD de contactos:
   - `POST /contacts` (alta manual),
   - `GET /contacts/:contactId` (detalle para edicion),
   - `PUT /contacts/:contactId` (edicion),
   - `GET /contacts?search=&group=&page=&pageSize=` (listado filtrado),
   - `DELETE /contacts/:contactId` (baja logica o fisica, segun decision).
2. Reutilizar las mismas validaciones de numero/normalizacion usadas en CSV.
3. Permitir asignar o crear `grupo` desde alta manual.
4. Registrar `source='manual'` en contactos creados desde formulario.

Aceptacion:

- usuario puede cargar contactos sin CSV,
- contactos manuales quedan disponibles para campañas y metricas,
- sin cruces entre usuarios.

## Fase 3: Campañas persistentes

1. En `POST /send-messages`, antes de encolar:
   - crear `campaign`,
   - crear `campaign_recipient` para cada destinatario.
2. Pasar `campaignId` al job de BullMQ (`enqueueCampaign`).
3. Mantener compatibilidad con flujo actual de Redis status para UI en vivo.

Aceptacion:

- toda campaña tiene trazabilidad historica completa aunque Redis expire.

## Fase 4: Persistir resultado de envio por destinatario

1. En worker (`src/queueRedis.js`), al cambiar estado:
   - actualizar `campaign_recipient.status`,
   - incrementar contadores de `campaign`,
   - insertar `campaign_event`.
2. Al completar/cancelar:
   - cerrar `campaign.status`, `finished_at`.

Aceptacion:

- metricas de `campaign` coinciden con suma de destinatarios.

## Fase 5: Endpoints de dashboard

Crear nuevos endpoints (protegidos con `conditionalAuth` + rol):

1. `GET /dashboard/summary?from&to`
   - total campañas, total enviados, total errores, success rate.
2. `GET /dashboard/timeline?from&to&bucket=hour|day|month`
   - serie temporal enviados/errores.
3. `GET /dashboard/by-group?from&to`
   - distribucion por grupo (para torta).
4. `GET /dashboard/by-contact?from&to&limit=20`
   - top clientes por volumen/fallos.
5. `GET /dashboard/current-month`
   - total enviados en el mes actual, errores del mes y success rate mensual.
6. `GET /dashboard/monthly?months=12`
   - tendencia mensual (ultimos N meses) para grafico por mes.
7. `GET /campaigns/:id`
   - detalle de campaña.

Aceptacion:

- todas las consultas filtran por `user_id` derivado de `req.auth.sub`,
- tiempos de respuesta aceptables con indices (<500ms en datasets medianos).

## Fase 6: Dashboard UI real

1. Descomentar/activar tab analytics en `public/index.html`.
2. Reemplazar placeholders por datos reales via fetch autenticado.
3. Agregar libreria de graficos (Chart.js recomendado en vanilla JS):
   - linea de tiempo: enviados vs errores por hora/dia/mes,
   - torta: distribucion por grupo.
4. Agregar filtros:
   - rango de fechas,
   - grupo,
   - campaña (opcional).
5. Agregar KPI mensual visible:
   - "Mensajes enviados este mes",
   - "% exito del mes",
   - comparativo contra mes anterior.
6. Agregar tabla detalle (contacto, grupo, enviados, errores, ultima actividad).

Aceptacion:

- dashboard responde con datos reales por usuario logueado,
- graficos se actualizan al cambiar filtros,
- se visualiza claramente el avance mensual de envios.

## Fase 7: Calidad y observabilidad

1. Tests unitarios:
   - parser CSV (con/sin headers, invalidos, duplicados, grupo).
2. Tests integracion:
   - import de contactos,
   - persistencia de resultado de envios,
   - aislamiento por usuario.
3. Logs estructurados con `campaignId`, `contactId`, `userId`.

Aceptacion:

- cobertura minima en nuevos modulos criticos,
- trazabilidad end-to-end de una campaña.

## 7) Cambios de API/contrato recomendados

Mantener `POST /send-messages` pero extender payload:

- `campaignName` (string, opcional recomendado)
- `csvFile`
- `templates`
- media actual (sin romper compatibilidad)

Respuesta sugerida:

- `campaignId`
- `totalNumbers`
- `importSummary` (inserted/updated/duplicates/invalid)

Agregar API de contactos manuales:

- `POST /contacts`
- `GET /contacts/:contactId`
- `PUT /contacts/:contactId`
- `GET /contacts`
- `DELETE /contacts/:contactId`

Payload recomendado de contacto:

- `phone`
- `nombre`
- `tratamiento`
- `grupo`

## 8) Consideraciones de seguridad y multi-tenant

1. Ninguna consulta de dashboard debe aceptar `userId` por query/body.
2. `userId` siempre debe salir del token (`req.auth.sub`).
3. Claves unicas por tenant (`user_id` + campo negocio).
4. Evitar exponer PII en logs de error (enmascarar telefonos si aplica).

## 9) Riesgos y mitigacion

1. Riesgo: crecer volumen de eventos rapidamente.
   Mitigacion: TTL/particionado por fecha para `campaign_event` o archivado mensual.

2. Riesgo: queries lentas en dashboard.
   Mitigacion: indices + vistas materializadas para agregados diarios.

3. Riesgo: diferencias entre status Redis en vivo y DB persistente.
   Mitigacion: DB como fuente de verdad final y reconciliacion al cerrar campaña.

## 10) Definicion de listo (DoD)

1. Import CSV crea/actualiza contactos y grupos en DB por usuario Keycloak.
2. Alta manual crea/actualiza contactos y grupos en DB por usuario Keycloak.
3. Cada envio queda registrado por campaña y destinatario.
4. Se pueden consultar metricas por grupo y por contacto.
5. Dashboard muestra:
   - KPI resumen,
   - linea de tiempo,
   - torta por grupo,
   - total de mensajes enviados del mes actual y tendencia mensual.
6. Sin regresiones en flujo actual de envio.

## 11) Orden de implementacion sugerido (resumen ejecutivo)

1. DB + migraciones.
2. Importador de contactos y grupos (CSV).
3. CRUD manual de contactos.
4. Persistencia de campañas/envios.
5. Endpoints analytics (incluyendo mensual).
6. Dashboard visual.
7. Tests y hardening.
