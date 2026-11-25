-- Ejecutar una vez en el SQL Editor de Supabase. No modifica pedidos ni facturas.
create table if not exists public.productos_fiscales (
 sku text primary key check(length(sku) between 1 and 100 and sku=upper(trim(sku))),
 titulo text not null check(length(titulo) between 1 and 1000),
 clave_prod_serv_sat text not null check(clave_prod_serv_sat ~ '^[0-9]{8}$'),
 clave_unidad text not null default 'H87' check(clave_unidad ~ '^[a-zA-Z0-9]{2,3}$'),
 unidad text not null default 'Pieza' check(length(unidad) between 1 and 100),
 actualizado_en timestamptz not null default now()
);
alter table public.productos_fiscales enable row level security;
revoke all on public.productos_fiscales from anon, authenticated;
grant select,insert,update on public.productos_fiscales to service_role;
