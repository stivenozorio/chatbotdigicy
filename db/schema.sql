-- Esquema inicial de Digicyus SI (MySQL 5.7+/8.x).
-- Solo crea tablas si no existen; no borra ni modifica datos existentes.
-- NO se ejecuta automáticamente: aplícalo manualmente en la base de datos.
--
-- Aislamiento multiempresa: toda tabla de datos lleva business_id, y las claves
-- foráneas compuestas (id, business_id) impiden mezclar datos de negocios distintos.
-- Todas las consultas de la aplicación deben filtrar siempre por business_id.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS businesses (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(150)    NOT NULL,
  slug          VARCHAR(100)    NOT NULL,
  status        ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_businesses_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un bot por número de WhatsApp. Los tokens/secretos NO se guardan aquí en texto plano.
CREATE TABLE IF NOT EXISTS bots (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id              BIGINT UNSIGNED NOT NULL,
  name                     VARCHAR(150)    NOT NULL,
  whatsapp_phone_number_id VARCHAR(64)     NULL,
  system_prompt            TEXT            NULL,
  is_active                TINYINT(1)      NOT NULL DEFAULT 1,
  created_at               TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bots_id_business (id, business_id),
  UNIQUE KEY uq_bots_phone_number_id (whatsapp_phone_number_id),
  KEY idx_bots_business (business_id),
  CONSTRAINT fk_bots_business FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contacts (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id  BIGINT UNSIGNED NOT NULL,
  wa_id        VARCHAR(32)     NOT NULL,
  name         VARCHAR(150)    NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contacts_id_business (id, business_id),
  UNIQUE KEY uq_contacts_business_wa (business_id, wa_id),
  CONSTRAINT fk_contacts_business FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id      BIGINT UNSIGNED NOT NULL,
  bot_id           BIGINT UNSIGNED NOT NULL,
  contact_id       BIGINT UNSIGNED NOT NULL,
  status           ENUM('open','closed') NOT NULL DEFAULT 'open',
  last_message_at  TIMESTAMP       NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversations_id_business (id, business_id),
  KEY idx_conversations_business_contact (business_id, contact_id),
  KEY idx_conversations_business_last (business_id, last_message_at),
  KEY idx_conversations_bot (bot_id),
  CONSTRAINT fk_conversations_bot FOREIGN KEY (bot_id, business_id) REFERENCES bots (id, business_id) ON DELETE CASCADE,
  CONSTRAINT fk_conversations_contact FOREIGN KEY (contact_id, business_id) REFERENCES contacts (id, business_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id        BIGINT UNSIGNED NOT NULL,
  conversation_id    BIGINT UNSIGNED NOT NULL,
  direction          ENUM('inbound','outbound') NOT NULL,
  sender             ENUM('contact','bot','human') NOT NULL,
  body               TEXT            NULL,
  whatsapp_message_id VARCHAR(128)   NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_messages_whatsapp_id (whatsapp_message_id),
  KEY idx_messages_conversation (business_id, conversation_id, created_at),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id, business_id) REFERENCES conversations (id, business_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
