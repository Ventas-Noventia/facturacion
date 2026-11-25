-- Solo lectura. Ambas consultas deben devolver CERO filas antes de aplicar 012.
-- Si aparecen filas, revisar esas facturas; este script no elimina ni cancela nada.
select upper(btrim(data->>'folioOrigen')) as pedido,
       count(*) as facturas_activas,
       array_agg(folio_interno order by numero) as folios
from public.facturas
where nullif(btrim(data->>'folioOrigen'), '') is not null
  and coalesce(data->>'estatus', '') not like 'CANCELADA%'
group by upper(btrim(data->>'folioOrigen'))
having count(*) > 1;

select data->'pedido'->>'ecommerceId' as ecommerce_id,
       count(*) as facturas_activas,
       array_agg(folio_interno order by numero) as folios
from public.facturas
where data->'pedido'->>'fuente' = 'ECOMMERCE_API'
  and data->'pedido'->>'ecommerceId' is not null
  and coalesce(data->>'estatus', '') not like 'CANCELADA%'
group by data->'pedido'->>'ecommerceId'
having count(*) > 1;
