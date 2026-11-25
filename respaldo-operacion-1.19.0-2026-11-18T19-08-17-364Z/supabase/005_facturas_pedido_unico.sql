-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Expone el folio del JSON como columna generada y evita facturas duplicadas.

alter table public.facturas
  add column if not exists folio_origen text generated always as (
    nullif(btrim(data ->> 'folioOrigen'), '')
  ) stored;

create unique index if not exists facturas_folio_origen_unico_idx
  on public.facturas (folio_origen)
  where folio_origen is not null;

