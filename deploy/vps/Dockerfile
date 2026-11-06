# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS frontend
WORKDIR /build
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_DEMO_MODE=false \
    NEXT_PUBLIC_API_URL=/ternaku
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY next.config.ts next-env.d.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM nginx:stable-alpine AS web
COPY deploy/vps/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /build/out/ /usr/share/nginx/html/

FROM mysql:8.4 AS db
COPY api/schema.sql /docker-entrypoint-initdb.d/001-ternaku-schema.sql

FROM php:8.2-apache-bookworm AS php-base
RUN apt-get update && apt-get install -y --no-install-recommends libgmp-dev \
    && docker-php-ext-install -j2 pdo_mysql gmp \
    && rm -rf /var/lib/apt/lists/*
RUN php -r 'foreach (["pdo_mysql","curl","mbstring","openssl","gmp"] as $extension) { if (!extension_loaded($extension)) { fwrite(STDERR, "Missing PHP extension: ".$extension.PHP_EOL); exit(1); } }'
WORKDIR /srv/ternaku

FROM php-base AS dependencies
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
RUN apt-get update && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*
COPY api/composer.json api/composer.lock ./
RUN COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction \
    && composer check-platform-reqs --no-dev

FROM php-base AS api
COPY --from=dependencies /srv/ternaku/vendor ./vendor
COPY api/system ./system
COPY api/application ./application
COPY api/scripts ./scripts
COPY api/index.php api/schema.sql api/CI-LICENSE.txt ./
COPY deploy/vps/apache.conf /etc/apache2/sites-available/000-default.conf
RUN cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
    && printf '%s\n' '<?php require "/srv/ternaku/index.php";' > /var/www/html/index.php \
    && install -d -o www-data -g www-data -m 0750 /srv/ternaku/application/logs
