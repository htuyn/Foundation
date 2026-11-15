#!/usr/bin/env bash
# =============================================================================
# install_k6.sh  –  Cài đặt k6 load testing tool
# Chạy: bash scripts/install_k6.sh
# =============================================================================
set -euo pipefail

detect_os() {
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
        echo "windows"
    elif [[ -f /etc/debian_version ]]; then
        echo "debian"
    elif [[ -f /etc/redhat-release ]]; then
        echo "redhat"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    else
        echo "unknown"
    fi
}

OS=$(detect_os)
echo "==> Phát hiện hệ điều hành: $OS"

case "$OS" in
  windows)
    echo "    Trên Windows, chạy PowerShell:"
    echo "    winget install k6 --source winget"
    echo "    hoặc: choco install k6  (nếu dùng Chocolatey)"
    ;;
  debian)
    echo "==> Cài k6 trên Ubuntu/Debian..."
    sudo gpg --no-default-keyring \
        --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
        --keyserver hkp://keyserver.ubuntu.com:80 \
        --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
    echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
        | sudo tee /etc/apt/sources.list.d/k6.list
    sudo apt-get update -q
    sudo apt-get install -y k6
    echo "✓ k6 đã cài: $(k6 version)"
    ;;
  redhat)
    echo "==> Cài k6 trên RHEL/CentOS..."
    sudo dnf install https://dl.k6.io/rpm/repo.rpm -y
    sudo dnf install k6 -y
    echo "✓ k6 đã cài: $(k6 version)"
    ;;
  macos)
    echo "==> Cài k6 trên macOS..."
    if command -v brew &>/dev/null; then
        brew install k6
    else
        echo "Homebrew chưa cài. Tải tại: https://brew.sh"
        exit 1
    fi
    echo "✓ k6 đã cài: $(k6 version)"
    ;;
  *)
    echo "Không nhận dạng được OS. Tải k6 thủ công tại: https://k6.io/docs/get-started/installation/"
    exit 1
    ;;
esac
