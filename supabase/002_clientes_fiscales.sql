-- Ejecutar después de schema.sql en Supabase > SQL Editor.
create table if not exists public.clientes_fiscales (
  id uuid primary key default gen_random_uuid(),
  tipo_persona text not null check (tipo_persona in ('FISICA','MORAL')),
  razon_social text not null,
  rfc text not null,
  codigo_postal text not null,
  regimen_fiscal text not null,
  uso_cfdi text not null,
  email text not null default '',
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint clientes_fiscales_rfc_unique unique (rfc),
  constraint clientes_fiscales_cp_check check (codigo_postal ~ '^[0-9]{5}$')
);

create index if not exists clientes_fiscales_busqueda_idx
  on public.clientes_fiscales (razon_social, rfc);

alter table public.clientes_fiscales enable row level security;

-- Solo el backend con service_role accede a esta información fiscal.
