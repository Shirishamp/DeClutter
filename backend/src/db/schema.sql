CREATE TABLE IF NOT EXISTS accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,        -- e.g. 'google_drive', 'onedrive'
  account_label VARCHAR(100) NOT NULL,  -- e.g. 'Personal', 'College', 'Work'
  email VARCHAR(255),
  access_token TEXT,
  refresh_token TEXT,
  token_expiry DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  file_id VARCHAR(255) NOT NULL,        -- ID from the provider (Google/Microsoft)
  file_name VARCHAR(500) NOT NULL,
  file_type VARCHAR(100),
  file_size BIGINT,                     -- size in bytes
  folder_path VARCHAR(1000),
  modified_date DATETIME,
  indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  UNIQUE KEY unique_file_per_account (account_id, file_id)
);