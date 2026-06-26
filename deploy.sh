#!/bin/bash
# ============================================================
#  DEPLOY SCRIPT - PPM Dashboard & Nayaxa Engine
#  Server: bapperida-ppm.my.id (103.171.84.129)
#  Update skrip ini jika struktur folder berubah di server
# ============================================================

set -e  # Hentikan script jika ada error

# ─────────────────────────────────────────
#  KONFIGURASI - Sesuaikan dengan server
# ─────────────────────────────────────────
DASHBOARD_DIR="/var/www/dashboard-ppm"
NAYAXA_DIR="/var/www/nayaxa-engine"
PM2_DASHBOARD_NAME="ppm-backend"
PM2_NAYAXA_NAME="nayaxa-engine"

# Warna untuk output yang lebih mudah dibaca
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Ambil target deploy dari argumen (default: both)
TARGET=${1:-"both"}

print_step() { echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "${BLUE}  ▶ $1${NC}"; echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }
print_ok()   { echo -e "  ${GREEN}✓ $1${NC}"; }
print_warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }
print_err()  { echo -e "  ${RED}✗ $1${NC}"; }

echo -e "\n${BLUE}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     🚀 MEMULAI DEPLOYMENT PPM + NAYAXA           ║${NC}"
echo -e "${BLUE}║     Target: $(echo "$TARGET" | tr '[:lower:]' '[:upper:]')                          ║${NC}"
echo -e "${BLUE}║     $(date '+%Y-%m-%d %H:%M:%S')                         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════╝${NC}"


# ════════════════════════════════════════════════════════
#  BAGIAN 1: DASHBOARD (copy-dashboard → ppm-dashboard)
# ════════════════════════════════════════════════════════

if [ "$TARGET" = "both" ] || [ "$TARGET" = "dashboard" ]; then
if [ -d "$DASHBOARD_DIR" ]; then
    print_step "DASHBOARD - Menarik kode terbaru dari Git"
    cd "$DASHBOARD_DIR"
    git pull origin prod
    print_ok "Git pull dashboard selesai"

    print_step "DASHBOARD - Menginstall dependensi Backend"
    cd "$DASHBOARD_DIR/Backend"
    npm install --omit=dev 2>&1 | tail -5
    print_ok "npm install backend selesai"

    print_step "DASHBOARD - Menjalankan migrasi database (tracker)"
    cd "$DASHBOARD_DIR/Backend"
    node scripts/migrations/run_migrations.js
    print_ok "Migrasi database dashboard selesai"

    print_step "DASHBOARD - Menginstall dependensi Frontend"
    cd "$DASHBOARD_DIR/Frontend"
    npm install --omit=dev 2>&1 | tail -5
    print_ok "npm install frontend selesai"

    print_step "DASHBOARD - Build Frontend (Vite)"
    cd "$DASHBOARD_DIR/Frontend"
    # Meningkatkan limit memori Node.js agar tidak crash (Heap Out Of Memory) di VPS RAM terbatas
    NODE_OPTIONS="--max-old-space-size=2048" npm run build
    print_ok "Build frontend selesai"

    print_step "DASHBOARD - Restart PM2 Backend"
    cd "$DASHBOARD_DIR"
    if pm2 describe "$PM2_DASHBOARD_NAME" > /dev/null 2>&1; then
        pm2 restart "$PM2_DASHBOARD_NAME" --update-env
        print_ok "PM2 $PM2_DASHBOARD_NAME berhasil di-restart"
    else
        print_warn "PM2 process '$PM2_DASHBOARD_NAME' tidak ditemukan. Menjalankan baru..."
        cd "$DASHBOARD_DIR/Backend"
        pm2 start src/index.js --name "$PM2_DASHBOARD_NAME"
        print_ok "PM2 $PM2_DASHBOARD_NAME berhasil dijalankan"
    fi
else
    print_warn "Folder dashboard tidak ditemukan di $DASHBOARD_DIR, melewati..."
fi
fi


# ════════════════════════════════════════════════════════
#  BAGIAN 2: NAYAXA ENGINE
# ════════════════════════════════════════════════════════

if [ "$TARGET" = "both" ] || [ "$TARGET" = "nayaxa" ]; then
if [ -d "$NAYAXA_DIR" ]; then
    print_step "NAYAXA - Menarik kode terbaru dari Git"
    cd "$NAYAXA_DIR"
    git pull origin main
    print_ok "Git pull nayaxa selesai"

    print_step "NAYAXA - Menginstall dependensi Backend"
    cd "$NAYAXA_DIR/Backend"
    npm install --omit=dev 2>&1 | tail -5
    print_ok "npm install nayaxa backend selesai"

    print_step "NAYAXA - Menjalankan migrasi database"
    cd "$NAYAXA_DIR/Backend"
    npm run migrate
    print_ok "Migrasi database nayaxa selesai"

    if [ -d "$NAYAXA_DIR/Frontend" ]; then
        print_step "NAYAXA - Menginstall dependensi Frontend"
        cd "$NAYAXA_DIR/Frontend"
        npm install 2>&1 | tail -5
        print_ok "npm install nayaxa frontend selesai"

        print_step "NAYAXA - Build Frontend (Vite)"
        cd "$NAYAXA_DIR/Frontend"
        NODE_OPTIONS="--max-old-space-size=2048" npm run build
        print_ok "Build nayaxa frontend selesai"
    fi

    if [ -d "$NAYAXA_DIR/Widget" ]; then
        print_step "NAYAXA - Menginstall dependensi Widget"
        cd "$NAYAXA_DIR/Widget"
        npm install 2>&1 | tail -5
        print_ok "npm install nayaxa widget selesai"

        print_step "NAYAXA - Build Widget (Vite)"
        cd "$NAYAXA_DIR/Widget"
        NODE_OPTIONS="--max-old-space-size=2048" npm run build
        print_ok "Build nayaxa widget selesai"
    fi

    # ── Cek .env NAYAXA_PUBLIC_URL (kritis untuk link download PDF/Word) ──
    print_step "NAYAXA - Verifikasi konfigurasi .env"
    NAYAXA_ENV_FILE="$NAYAXA_DIR/Backend/.env"
    if [ ! -f "$NAYAXA_ENV_FILE" ]; then
        print_warn "File .env tidak ditemukan di $NAYAXA_ENV_FILE!"
        print_warn "Membuat .env dari template default..."
        cat > "$NAYAXA_ENV_FILE" << 'EOF'
# ========================================
# KONFIGURASI NAYAXA ENGINE - SERVER
# ========================================
# WAJIB: URL publik yang bisa diakses browser untuk link download PDF/Word
# Tanpa ini, link download akan rusak (SSL error / connection reset)
NAYAXA_PUBLIC_URL=https://bapperida-ppm.my.id/api/nayaxa

PORT=6001
EOF
        print_warn "File .env dibuat. Silakan edit $NAYAXA_ENV_FILE untuk mengisi kredensial database!"
    else
        # Pastikan NAYAXA_PUBLIC_URL sudah ada di .env
        if ! grep -q "NAYAXA_PUBLIC_URL" "$NAYAXA_ENV_FILE"; then
            print_warn "NAYAXA_PUBLIC_URL tidak ditemukan di .env — Menambahkannya..."
            echo "NAYAXA_PUBLIC_URL=https://bapperida-ppm.my.id/api/nayaxa" >> "$NAYAXA_ENV_FILE"
            print_ok "NAYAXA_PUBLIC_URL ditambahkan ke .env"
        else
            CURRENT_URL=$(grep "NAYAXA_PUBLIC_URL" "$NAYAXA_ENV_FILE" | cut -d'=' -f2)
            print_ok "NAYAXA_PUBLIC_URL terdeteksi: $CURRENT_URL"
        fi
    fi

    print_step "NAYAXA - Restart PM2"
    if pm2 describe "$PM2_NAYAXA_NAME" > /dev/null 2>&1; then
        pm2 restart "$PM2_NAYAXA_NAME" --update-env
        print_ok "PM2 $PM2_NAYAXA_NAME berhasil di-restart"
    else
        print_warn "PM2 process '$PM2_NAYAXA_NAME' tidak ditemukan. Menjalankan baru..."
        cd "$NAYAXA_DIR/Backend"
        pm2 start src/index.js --name "$PM2_NAYAXA_NAME"
        print_ok "PM2 $PM2_NAYAXA_NAME berhasil dijalankan"
    fi
else
    print_warn "Folder nayaxa tidak ditemukan di $NAYAXA_DIR, melewati..."
fi
fi


# ════════════════════════════════════════════════════════
#  SELESAI
# ════════════════════════════════════════════════════════
print_step "Menyimpan konfigurasi PM2"
pm2 save
print_ok "PM2 save selesai"

echo -e "\n${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     🎉 DEPLOYMENT SELESAI DENGAN SUKSES!          ║${NC}"
echo -e "${GREEN}║     $(date '+%Y-%m-%d %H:%M:%S')                         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"

echo -e "\n${YELLOW}Status PM2 saat ini:${NC}"
pm2 list

echo -e "\n${YELLOW}Tip: Jalankan 'pm2 logs' untuk memantau log secara live.${NC}\n"
