create table if not exists admin_roles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade,
  role text check (role in ('super_admin', 'ambassador')),
  assigned_cities text[],
  assigned_states text[],
  created_at timestamptz default now(),
  unique(user_id)
);

create index if not exists admin_roles_user_id_idx on admin_roles(user_id);

alter table admin_roles enable row level security;

-- A user can always see their own role (so the client can decide whether to
-- show admin UI at all); a super_admin can additionally see every row (to
-- list/manage ambassadors). No INSERT/UPDATE/DELETE policy for
-- authenticated/anon at all — role assignment only ever happens through the
-- service-role admin client in pages/api/admin/assign-ambassador.js.
drop policy if exists admin_roles_select_own_or_super on admin_roles;
create policy admin_roles_select_own_or_super
  on admin_roles for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from admin_roles ar2 where ar2.user_id = auth.uid() and ar2.role = 'super_admin')
  );

-- Seed this admin only when the referenced profile exists.
-- Fresh Supabase branches do not copy production auth/profile data.
insert into admin_roles (user_id, role, assigned_cities, assigned_states)
select id, 'super_admin', null, null
from profiles
where id = '1c70f0fd-fd65-4550-8186-a50280f12b53'
on conflict (user_id) do update set role = 'super_admin';

-- Needed for the Reports/Moderation Queue's "Suspend User" action to have
-- something to actually set.
alter table profiles add column if not exists is_suspended boolean default false;
