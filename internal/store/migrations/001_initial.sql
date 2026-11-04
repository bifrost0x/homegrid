CREATE TABLE categories (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 sort_order INTEGER NOT NULL DEFAULT 0,
 collapsed INTEGER NOT NULL DEFAULT 0 CHECK(collapsed IN (0,1))
);
INSERT INTO categories(id,name,sort_order) VALUES(1,'General',0);
CREATE TABLE applications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 url TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 icon TEXT NOT NULL DEFAULT '',
 category_id INTEGER NOT NULL DEFAULT 1 REFERENCES categories(id) ON DELETE RESTRICT,
 sort_order INTEGER NOT NULL DEFAULT 0,
 open_in_new_tab INTEGER NOT NULL DEFAULT 1 CHECK(open_in_new_tab IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX applications_order ON applications(sort_order,id);
CREATE INDEX applications_category ON applications(category_id);
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
INSERT INTO settings VALUES(1,'{"title":"My HomeGrid","theme":"system","accent":"sage","density":"comfortable","radius":"rounded","background":"","blur":false,"show_descriptions":true}');
CREATE TABLE users (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX session_expiry ON sessions(expires_at);
