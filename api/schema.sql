-- MySQL 5.7+/8.0 or MariaDB 10.4+, all stock writes are atomic InnoDB transactions.
CREATE TABLE IF NOT EXISTS users (
 id VARCHAR(40) PRIMARY KEY,
 name VARCHAR(120) NOT NULL,
 email VARCHAR(190) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL,
 role ENUM('admin','employee') NOT NULL,
 active TINYINT(1) NOT NULL DEFAULT 1,
 target DECIMAL(14,0) NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tokens (
 token_hash CHAR(64) PRIMARY KEY,
 user_id VARCHAR(40) NOT NULL,
 expires_at DATETIME NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (user_id) REFERENCES users(id), INDEX(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS login_attempts (
 attempt_key CHAR(64) PRIMARY KEY,
 attempts INT NOT NULL DEFAULT 0,
 started_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Records contain validated, typed document payloads; kind/owner/date indexes support reports.
-- Financial item price snapshots stay in their immutable parent sale document.
CREATE TABLE IF NOT EXISTS records (
 id VARCHAR(40) PRIMARY KEY,
 sequence BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
 kind VARCHAR(30) NOT NULL,
 user_id VARCHAR(40) NULL,
 occurred_at DATETIME NOT NULL,
 data LONGTEXT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX(kind, occurred_at), INDEX(kind, user_id),
 FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS stock (
 stock_key VARCHAR(60) PRIMARY KEY,
 eggs BIGINT NOT NULL DEFAULT 0,
 kg DECIMAL(15,3) NOT NULL DEFAULT 0,
 trays BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS command_mutex (
 id INT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS command_requests (
 user_id VARCHAR(40) NOT NULL,
 request_id VARCHAR(80) NOT NULL,
 fingerprint CHAR(64) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id, request_id),
 FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO command_mutex(id, version) VALUES (1,0);
INSERT IGNORE INTO stock(stock_key,eggs,kg) VALUES ('egg:good',0,0),('egg:cracked',0,0);
