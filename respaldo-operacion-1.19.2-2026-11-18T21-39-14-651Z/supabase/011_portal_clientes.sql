-- Portal externo de autofacturación Noventia v1.16.0
-- Ejecutar una sola vez en Supabase > SQL Editor.

create table if not exists public.portal_clientes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  telefono text not null default '',
  nombre text not null,
  tipo_persona text not null default 'FISICA' check (tipo_persona in ('FISICA','MORAL')),
  razon_social text not null default '',
  rfc text not null default '',
  codigo_postal text not null default '',
  regimen_fiscal text not null default '',
  uso_cfdi text not null default 'G03',
  aviso_version text not null,
  aviso_aceptado_en timestamptz not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index if not exists portal_clientes_email_unique on public.portal_clientes(lower(email));
create index if not exists portal_clientes_rfc_idx on public.portal_clientes(rfc) where rfc <> '';

alter table public.portal_clientes enable row level security;

drop policy if exists "portal cliente consulta su perfil" on public.portal_clientes;
create policy "portal cliente consulta su perfil" on public.portal_clientes
for select to authenticated using (auth.uid() = user_id);

drop policy if exists "portal cliente actualiza su perfil" on public.portal_clientes;
create policy "portal cliente actualiza su perfil" on public.portal_clientes
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.portal_clientes is 'Perfiles fiscales y consentimiento del portal externo de autofacturación';
