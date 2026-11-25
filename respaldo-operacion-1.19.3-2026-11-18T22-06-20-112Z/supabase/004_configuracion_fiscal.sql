create table if not exists public.configuracion_fiscal (
  id text primary key check (id = 'principal'),
  razon_social text not null,
  rfc text not null,
  regimen_fiscal text not null,
  codigo_postal text not null check (codigo_postal ~ '^[0-9]{5}$'),
  serie text not null default 'F',
  version_cfdi text not null default '4.0' check (version_cfdi = '4.0'),
  exportacion text not null default '01',
  pac_proveedor text not null default 'PENDIENTE',
  ambiente text not null default 'PRUEBAS' check (ambiente in ('PRUEBAS','PRODUCCION')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
alter table public.configuracion_fiscal enable row level security;

-- No guardar aquí archivos .cer, .key ni contraseñas.
