-- Run after the existing schema/migrations. No credentials are stored here.
-- The API order ID remains the identity, even when a buyer searches by folio.
begin;
create unique index if not exists facturas_ecommerce_pedido_activo_unico_idx
  on public.facturas ((data->'pedido'->>'ecommerceId'))
  where data->'pedido'->>'fuente' = 'ECOMMERCE_API'
    and data->'pedido'->>'ecommerceId' is not null
    and coalesce(data->>'estatus','') not like 'CANCELADA%';
commit;
