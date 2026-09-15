-- Ejecutar una sola vez en Supabase > SQL Editor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos-fiscales',
  'documentos-fiscales',
  false,
  10485760,
  array['application/xml', 'text/xml', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No se crean políticas públicas. Los archivos se sirven exclusivamente desde
-- el backend autenticado mediante la service_role.
