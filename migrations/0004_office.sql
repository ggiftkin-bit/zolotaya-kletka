-- Склад тракта и дела конторы. Золото государства в книге не копится.
-- stock — куча по товару, 0…∞, лавка у игрока не берёт выше 100 и не продаёт с нуля.

alter table world
  add column if not exists stock jsonb not null default '{}'::jsonb;
