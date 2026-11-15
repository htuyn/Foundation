#!/usr/bin/env bash
# =============================================================================
# install_k6.sh  –  Cài đặt công cụ đo tải k6 (Ubuntu/Debian, macOS, Windows)
#
# Cách dùng:
#   bash scripts/install_k6.sh
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
    echo "==> Cài đặt k6 trên Windows:"
    if command -v winget &>/dev/null; then
        echo "    Đang chạy: winget install k6 --source winget ..."
        winget install k6 --source winget || true
    elif command -v choco &>/dev/null; then
        echo "    Đang chạy: choco install k6 ..."
        choco install k6 -y || true
    else
        echo "    Vui lòng mở PowerShell (Run as Administrator) và chạy một trong các lệnh sau:"
        echo "      winget install k6 --source winget"
        echo "      # hoặc dùng Chocolatey:"
        echo "      choco install k6"
    fi
    ;;

  debian)
    echo "==> Cài đặt k6 trên Ubuntu / Debian..."
    sudo apt-get update -q
    sudo apt-get install -y ca-certificates curl gnupg

    # Thêm GPG key của Grafana k6 (hỗ trợ cả keyserver lẫn direct download)
    if ! sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69 2>/dev/null; then
        echo "    Keyserver bận, thử tải key trực tiếp từ dl.k6.io..."
        curl -fsSL https://dl.k6.io/key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg
    fi

    echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
        | sudo tee /etc/apt/sources.list.d/k6.list > /dev/null

    sudo apt-get update -q
    sudo apt-get install -y k6
    echo "✓ Cài đặt thành công: $(k6 version)"
    ;;

  redhat)
    echo "==> Cài đặt k6 trên RHEL / CentOS / Fedora..."
    sudo dnf install -y https://dl.k6.io/rpm/repo.rpm
    sudo dnf install -y k6
    echo "✓ Cài đặt thành công: $(k6 version)"
    ;;

  macos)
    echo "==> Cài đặt k6 trên macOS..."
    if command -v brew &>/dev/null; then
        brew install k6
    else
        echo "Homebrew chưa cài. Tải tại: https://brew.sh"
        exit 1
    fi
    echo "✓ Cài đặt thành công: $(k6 version)"
    ;;

  *)
    echo "Hệ điều hành chưa được nhận diện tự động."
    echo "Các lựa chọn cài đặt thủ công:"
    echo "  1. Snap: sudo snap install k6"
    echo "  2. Docker: docker run --rm -i grafana/k6 version"
    echo "  3. Tải binary tại: https://k6.io/docs/get-started/installation/"
    exit 1
    ;;
esac
