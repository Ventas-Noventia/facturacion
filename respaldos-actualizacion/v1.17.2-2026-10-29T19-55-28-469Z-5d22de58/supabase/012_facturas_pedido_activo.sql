-- Una factura ACTIVA por pedido. No modifica ni elimina facturas.
-- Ejecutar despues de las migraciones ya instaladas, no repetir todo schema.sql.
-- La transaccion se revierte si existen duplicados activos que requieren revision.
begin;

create unique index if not exists facturas_folio_origen_activo_unico_idx
  on public.facturas ((upper(nullif(btrim(data->>'folioOrigen'), ''))))
  where nullif(btrim(data->>'folioOrigen'), '') is not null
    and coalesce(data->>'estatus', '') not like 'CANCELADA%';

create unique index if not exists facturas_ecommerce_pedido_activo_unico_idx
  on public.facturas ((data->'pedido'->>'ecommerceId'))
  where data->'pedido'->>'fuente' = 'ECOMMERCE_API'
    and data->'pedido'->>'ecommerceId' is not null
    and coalesce(data->>'estatus', '') not like 'CANCELADA%';

-- El indice anterior tambien bloqueaba pedidos con facturas canceladas.
-- Se retira solo despues de crear correctamente ambos indices activos.
drop index if exists public.facturas_folio_origen_unico_idx;

commit;
