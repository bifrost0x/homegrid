ALTER TABLE applications ADD COLUMN icon_color TEXT NOT NULL DEFAULT 'auto' CHECK(icon_color IN ('auto','sage','blue','amber','rose','violet','cyan'));
