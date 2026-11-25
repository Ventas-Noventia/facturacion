-- El cliente actualiza sus datos por el backend, que controla la identidad y el estado de la cuenta.
drop policy if exists "portal cliente actualiza su perfil" on public.portal_clientes;
revoke insert, update, delete on public.portal_clientes from anon, authenticated;
grant select, insert, update on public.portal_clientes to service_role;
