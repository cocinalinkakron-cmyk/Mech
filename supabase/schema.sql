-- Esquema de Mech para Supabase.
-- Ejecútalo una vez en: Supabase → SQL Editor → New query → pegar → Run.

create table if not exists public.shop (
  id         smallint primary key default 1 check (id = 1), -- una sola fila: los datos del taller
  name       text not null default 'Taller Mech',
  phone      text not null default '',
  base_url   text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  customer        jsonb not null default '{}'::jsonb,  -- { name, phone }
  vehicle         jsonb not null default '{}'::jsonb,  -- { make, model, year, plate, color }
  service         text not null default '',
  status          text not null default 'recibido' check (status in
                    ('recibido','diagnostico','presupuesto','piezas','reparacion','calidad','listo','entregado')),
  eta             date,
  budget          numeric(12,2) check (budget is null or budget >= 0),
  budget_approved boolean,
  history         jsonb not null default '[]'::jsonb,  -- [{ id, type, status, note, at }]
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists orders_updated_at_idx on public.orders (updated_at desc);
create index if not exists orders_status_idx on public.orders (status);

-- Seguridad: RLS activado y SIN políticas. Nadie puede leer ni escribir con la clave pública (anon);
-- solo el servidor de Mech, que usa la clave secreta. Los clientes ven su orden a través del servidor.
alter table public.shop   enable row level security;
alter table public.orders enable row level security;
