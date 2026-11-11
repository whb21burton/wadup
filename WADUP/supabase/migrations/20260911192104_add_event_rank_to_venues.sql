alter table venues add column if not exists event_rank integer default 999;
alter table venue_events add column if not exists performer text;
