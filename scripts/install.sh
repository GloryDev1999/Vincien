#!/usr/bin/env bash
# ==============================================================================
# Ghostic CLI — One-Line Installer for Linux & macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/GloryDev1999/Ghostic/master/install.sh | bash
# ==============================================================================

set -euo pipefail

# Text formatting
BOLD="\033[1m"
GREEN="\033[32m"
BLUE="\033[34m"
PURPLE="\033[35m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
DIM="\033[2m"
RESET="\033[0m"

REPO_URL="${GHOSTIC_REPO_URL:-https://github.com/GloryDev1999/Ghostic.git}"
BRANCH="${GHOSTIC_BRANCH:-master}"
INSTALL_DIR="${GHOSTIC_HOME:-$HOME/.ghostic}"
BIN_DIR="$HOME/.local/bin"

print_banner() {
  cat << 'BANNER'
\033[35m
   .---.
  /     \
 | () () |     \033[1mGhostic CLI Installer\033[0m\033[35m
  \  _  /      \033[2mAutonomous AI Engineering Harness\033[0m\033[35m
   || ||
   '' ''
\033[0m
BANNER
}

log_info() {
  echo -e "${CYAN}ℹ${RESET} $1"
}

log_success() {
  echo -e "${GREEN}✔${RESET} $1"
}

log_warn() {
  echo -e "${YELLOW}⚠${RESET} $1"
}

log_error() {
  echo -e "${RED}✖${RESET} $1" >&2
}

check_node() {
  log_info "Kiểm tra môi trường Node.js..."
  if ! command -v node >/dev/null 2>&1; then
    log_error "Node.js chưa được cài đặt trên máy của bạn."
    echo -e "${YELLOW}Vui lòng cài đặt Node.js (>= 22.19 hoặc 24) theo các cách sau:${RESET}"
    echo "  - Sử dụng NVM:  nvm install 22 && nvm use 22"
    echo "  - Sử dụng FNM:  fnm install 22 && fnm use 22"
    echo "  - Tải trực tiếp: https://nodejs.org/"
    exit 1
  fi

  NODE_VERSION=$(node -v | sed 's/^v//')
  MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d'.' -f1)
  MINOR_VERSION=$(echo "$NODE_VERSION" | cut -d'.' -f2)

  if [ "$MAJOR_VERSION" -lt 22 ] || ([ "$MAJOR_VERSION" -eq 22 ] && [ "$MINOR_VERSION" -lt 19 ]); then
    log_warn "Node.js hiện tại là v$NODE_VERSION. Khuyến nghị Node.js >= 22.19 hoặc >= 24 để hỗ trợ tối ưu."
  else
    log_success "Node.js v$NODE_VERSION đã sẵn sàng."
  fi
}

check_git() {
  if ! command -v git >/dev/null 2>&1; then
    log_error "Git chưa được cài đặt. Vui lòng cài đặt Git (sudo apt install git / brew install git)."
    exit 1
  fi
}

check_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    log_info "Đang tự động kích hoạt pnpm..."
    if command -v corepack >/dev/null 2>&1; then
      corepack enable pnpm || npm install -g pnpm
    else
      npm install -g pnpm
    fi
  fi
  log_success "pnpm $(pnpm -v) đã sẵn sàng."
}

install_ghostic() {
  if [ -d "$INSTALL_DIR" ]; then
    log_info "Thư mục $INSTALL_DIR đã tồn tại. Đang cập nhật phiên bản mới nhất..."
    cd "$INSTALL_DIR"
    git fetch origin "$BRANCH"
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
  else
    log_info "Đang tải Ghostic về thư mục: $INSTALL_DIR..."
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi

  log_info "Đang cài đặt các module phụ thuộc..."
  pnpm install --no-frozen-lockfile

  log_info "Đang biên dịch và đóng gói Ghostic Engine..."
  pnpm run build

  # Create bin directory
  mkdir -p "$INSTALL_DIR/bin"
  mkdir -p "$BIN_DIR"

  # Create wrapper executable
  cat > "$INSTALL_DIR/bin/ghostic" << 'WRAPPER'
#!/usr/bin/env bash
GHOSTIC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$GHOSTIC_ROOT/apps/cli/lib/bin.js" "$@"
WRAPPER
  chmod +x "$INSTALL_DIR/bin/ghostic"

  # Symlink to ~/.local/bin/ghostic
  ln -sf "$INSTALL_DIR/bin/ghostic" "$BIN_DIR/ghostic"

  # Also try symlink to /usr/local/bin if writable
  if [ -w "/usr/local/bin" ]; then
    ln -sf "$INSTALL_DIR/bin/ghostic" "/usr/local/bin/ghostic" 2>/dev/null || true
  fi
}

setup_path() {
  local SHELL_NAME
  SHELL_NAME=$(basename "${SHELL:-bash}")
  local RC_FILE=""

  case "$SHELL_NAME" in
    zsh)
      RC_FILE="$HOME/.zshrc"
      ;;
    bash)
      if [ -f "$HOME/.bashrc" ]; then
        RC_FILE="$HOME/.bashrc"
      else
        RC_FILE="$HOME/.profile"
      fi
      ;;
    *)
      RC_FILE="$HOME/.profile"
      ;;
  esac

  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    if [ -f "$RC_FILE" ]; then
      if ! grep -q "$BIN_DIR" "$RC_FILE"; then
        echo "" >> "$RC_FILE"
        echo "# Ghostic CLI PATH" >> "$RC_FILE"
        echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$RC_FILE"
        log_success "Đã tự động thêm $BIN_DIR vào $RC_FILE"
      fi
    fi
    export PATH="$BIN_DIR:$PATH"
  fi
}

main() {
  print_banner
  check_git
  check_node
  check_pnpm
  install_ghostic
  setup_path

  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}${GREEN}🎉 Chúc mừng! Ghostic CLI đã được cài đặt thành công!${RESET}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  echo -e "Để bắt đầu sử dụng, hãy mở một terminal mới hoặc chạy:"
  echo -e "  ${BOLD}${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}"
  echo -e "  ${BOLD}${PURPLE}ghostic${RESET}              # Mở giao diện chat tương tác (REPL)"
  echo -e "  ${BOLD}${PURPLE}ghostic \"nhiệm vụ\"${RESET}  # Chạy 1 tác vụ tự động"
  echo -e "  ${BOLD}${PURPLE}ghostic web${RESET}          # Mở giao diện Web UI"
  echo ""
}

main "$@"
