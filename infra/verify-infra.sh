#!/usr/bin/env bash
# Valida a fase 2: Node 18+, poppler, tesseract-por, pm2.
set -euo pipefail

ok=0
fail=0

check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "[OK]  ${name}"
    ok=$((ok + 1))
  else
    echo "[FAIL] ${name}"
    fail=$((fail + 1))
  fi
}

echo "==> Verificando infra OCR / NestJS"

if command -v node >/dev/null 2>&1; then
  major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [[ "${major}" -ge 18 ]]; then
    echo "[OK]  node $(node -v) (>= 18)"
    ok=$((ok + 1))
  else
    echo "[FAIL] node $(node -v) (precisa >= 18)"
    fail=$((fail + 1))
  fi
else
  echo "[FAIL] node não instalado"
  fail=$((fail + 1))
fi

check "npm" command -v npm
check "pm2" command -v pm2
check "pdftoppm (poppler-utils)" command -v pdftoppm
check "pdfinfo (poppler-utils)" command -v pdfinfo
check "tesseract" command -v tesseract

if command -v tesseract >/dev/null 2>&1; then
  if tesseract --list-langs 2>/dev/null | grep -qx 'por'; then
    echo "[OK]  tesseract idioma por"
    ok=$((ok + 1))
  else
    echo "[FAIL] tesseract sem idioma por (instale tesseract-ocr-por)"
    fail=$((fail + 1))
  fi
fi

# Smoke opcional: pdftoppm / tesseract respondem
if command -v pdftoppm >/dev/null 2>&1; then
  pdftoppm -v >/dev/null 2>&1 && echo "[OK]  pdftoppm responde" || echo "[FAIL] pdftoppm não responde"
fi
if command -v tesseract >/dev/null 2>&1; then
  tesseract --version >/dev/null 2>&1 && echo "[OK]  tesseract responde" || echo "[FAIL] tesseract não responde"
fi

echo
echo "Resumo: ${ok} ok, ${fail} falha(s)"
[[ "${fail}" -eq 0 ]]
