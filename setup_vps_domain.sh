#!/bin/bash
# ============================================================
#  SETUP DOMAIN NAYAXA - VPS 103.171.84.129
#  Domain: nayaxa.my.id, www.nayaxa.my.id, api.nayaxa.my.id
#  PENTING: Skrip ini TIDAK mengubah konfigurasi dashboard eksisting.
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "\n${BLUE}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      🌐 SETUP DOMAIN KHUSUS NAYAXA AI            ║${NC}"
echo -e "${BLUE}║      nayaxa.my.id  |  api.nayaxa.my.id           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════╝${NC}\n"

# 1. Pastikan dijalankan sebagai root / sudo
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Harap jalankan skrip ini sebagai root atau gunakan sudo:${NC} sudo bash $0"
    exit 1
fi

NAYAXA_DIR="/var/www/nayaxa-engine"

# 2. Build Frontend jika belum di-build
if [ -d "$NAYAXA_DIR/Frontend" ]; then
    echo -e "${CYAN}▶ Memeriksa & Build Frontend Nayaxa...${NC}"
    cd "$NAYAXA_DIR/Frontend"
    if [ ! -d "dist" ]; then
        npm install
        NODE_OPTIONS="--max-old-space-size=2048" npm run build
    else
        echo -e "${GREEN}✓ Folder dist Frontend sudah tersedia.${NC}"
    fi
fi

# 3. Buat Konfigurasi Nginx
echo -e "\n${CYAN}▶ Membuat konfigurasi Nginx untuk nayaxa.my.id...${NC}"
cat > /etc/nginx/sites-available/nayaxa.conf << 'EOF'
# ============================================================
#  NAYAXA WEB APPLICATION - Frontend SPA
# ============================================================
server {
    listen 80;
    server_name nayaxa.my.id www.nayaxa.my.id;

    root /var/www/nayaxa-engine/Frontend/dist;
    index index.html;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}

# ============================================================
#  NAYAXA AI ENGINE - Backend API & SSE Streaming
# ============================================================
server {
    listen 80;
    server_name api.nayaxa.my.id;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:6001;
        proxy_http_version 1.1;

        # WebSocket & Streaming headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable buffering for Server-Sent Events (SSE) chat streaming
        proxy_buffering off;
        proxy_cache off;

        # Long timeouts for complex AI reasoning and document generation
        proxy_connect_timeout 300s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;
    }
}
EOF

# 4. Aktifkan konfigurasi Nginx
echo -e "${CYAN}▶ Mengaktifkan vhost di sites-enabled...${NC}"
ln -sf /etc/nginx/sites-available/nayaxa.conf /etc/nginx/sites-enabled/nayaxa.conf

# 5. Uji sintaks Nginx
echo -e "${CYAN}▶ Menguji sintaks Nginx...${NC}"
nginx -t

# 6. Reload Nginx
echo -e "${CYAN}▶ Reload Nginx...${NC}"
systemctl reload nginx
echo -e "${GREEN}✓ Nginx berhasil di-reload dengan vhost baru!${NC}"

# 7. Memasang SSL dengan Certbot
echo -e "\n${CYAN}▶ Mengonfigurasi SSL (HTTPS) gratis via Let's Encrypt Certbot...${NC}"
if which certbot > /dev/null 2>&1; then
    certbot --nginx -d nayaxa.my.id -d www.nayaxa.my.id -d api.nayaxa.my.id --non-interactive --agree-tos --register-unsafely-without-email --redirect || {
        echo -e "${YELLOW}⚠ Certbot non-interactive gagal, mencoba mode interaktif...${NC}"
        certbot --nginx -d nayaxa.my.id -d www.nayaxa.my.id -d api.nayaxa.my.id
    }
    echo -e "${GREEN}✓ SSL HTTPS berhasil dipasang untuk nayaxa.my.id & api.nayaxa.my.id!${NC}"
else
    echo -e "${YELLOW}⚠ Certbot belum terinstall. Menginstall certbot python3-certbot-nginx...${NC}"
    apt update && apt install -y certbot python3-certbot-nginx
    certbot --nginx -d nayaxa.my.id -d www.nayaxa.my.id -d api.nayaxa.my.id --non-interactive --agree-tos --register-unsafely-without-email --redirect
fi

echo -e "\n${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   🎉 SETUP DOMAIN NAYAXA SELESAI!                ║${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║   Frontend : https://nayaxa.my.id                ║${NC}"
echo -e "${GREEN}║   Backend  : https://api.nayaxa.my.id            ║${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║   Widget Dashboard PPM tetap aman & normal!      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}\n"
