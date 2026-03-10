# Multibur Frontend - Fase 1 (Refactor Estructural)

Frontend en HTML + CSS + JavaScript puro, sin build step y compatible con Vercel.

## Estructura final

```text
app/
  css/
    global.css
    login.css
    admin.css
    operador.css
  js/
    config/
      config.js
    services/
      api.js
    utils/
      helpers.js
      validators.js
      formatters.js
      dom.js
      messages.js
      toast.js
    admin/
      admin-main.js
      admin-ui.js
      admin-realtime.js
      admin-events.js
      admin-orders.js
      admin-registros.js
      admin-render.js
      admin-actions.js
    operador/
      operador-main.js
      operador-ui.js
      operador-realtime.js
      operador-events.js
      operador-actions.js
      operador-trabajos.js
      operador-registros.js
      operador-render.js
    main.js
    admin.js
    operador.js
    login.js
    admin_catalogos.js
    admin_materiales_formatos.js
    admin_reportes.js
    auth.js
    api.js
    config.js
    supabaseClient.js
    ui.js
  pages/
    login.html
    admin.html
    admin_catalogos.html
    admin_materiales_formatos.html
    admin_reportes.html
    operador.html
```

## Entry points actuales

Se mantienen para compatibilidad con HTML y despliegue:

- `app/js/admin.js` (coordinador: delega en `admin/admin-main.js`)
- `app/js/operador.js` (coordinador: delega en `operador/operador-main.js`)
- `app/js/login.js`
- `app/js/admin_catalogos.js`
- `app/js/admin_materiales_formatos.js`
- `app/js/admin_reportes.js`

## Modulos por responsabilidad

- `js/admin/*`
  - `admin-main.js`: orquestacion principal Admin.
  - `admin-events.js`: enlace de eventos UI.
  - `admin-realtime.js`: suscripciones realtime y recargas.
  - `admin-orders.js`: transformaciones/normalizacion de ordenes.
  - `admin-registros.js`: utilidades de monitoreo y preset chips.
  - `admin-render.js`: badges y render auxiliar de pizarra.
  - `admin-actions.js`: utilidades de exportacion CSV.
  - `admin-ui.js`: mensajes/toasts de Admin.

- `js/operador/*`
  - `operador-main.js`: orquestacion principal Operador.
  - `operador-events.js`: enlace de eventos UI.
  - `operador-realtime.js`: suscripciones realtime Operador.
  - `operador-actions.js`: acciones y payloads de incidencia.
  - `operador-trabajos.js`: filtros de trabajos pendientes.
  - `operador-registros.js`: snapshot de KPIs de registro.
  - `operador-render.js`: render de banner de estado.
  - `operador-ui.js`: helpers UI + mensajes/toasts de Operador.

- `js/services/*`
  - `services/api.js`: implementacion de consultas/RPC Supabase.
  - `api.js` (legacy): wrapper `export *` por compatibilidad.

- `js/config/*`
  - `config/config.js`: configuracion runtime.
  - `config.js` (legacy): wrapper por compatibilidad.

- `js/utils/*`
  - `helpers.js`: normalizacion, escape y helpers numericos.
  - `formatters.js`: formateadores de fecha/hora/entrega.
  - `validators.js`: validaciones reutilizables.
  - `dom.js`: helpers DOM compartidos.
  - `messages.js`: creacion de setters de mensajes por id.
  - `toast.js`: controlador de toasts reutilizable.

## Legacy por compatibilidad

- `app/js/admin.js` y `app/js/operador.js` se conservan como entrypoints livianos.
- `app/js/api.js` y `app/js/config.js` se conservan como wrappers de compatibilidad.

## Deuda tecnica pendiente

- `admin-main.js` y `operador-main.js` aun concentran logica importante; fase siguiente puede dividir mas por dominio.
- `admin_catalogos.js`, `admin_materiales_formatos.js`, `admin_reportes.js`, `login.js` quedaron optimizados parcialmente (sin migracion agresiva).
- Aun falta cobertura automatizada de pruebas de regresion (UI + flujos criticos).
