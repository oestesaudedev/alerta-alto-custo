# Fase 4 no Windows: sobe a API no Docker, gera as amostras e roda os testes.
# Uso (na raiz extracao-dados):  .\api-extracao-texto\test\e2e\rodar-fase4.ps1 [-HostPort 3010]
param(
    [int]$HostPort = 3010
)

$ErrorActionPreference = 'Stop'
$raiz = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$compose = Join-Path $raiz 'infra\docker-compose.yml'

$env:API_HOST_PORT = $HostPort
docker compose -f $compose up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Falha ao subir o container da API' }

Write-Host 'Aguardando a API...'
for ($i = 0; $i -lt 30; $i++) {
    docker exec api-extracao-texto node -e "fetch('http://localhost:3010/extrair',{method:'POST'}).then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>$null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
}

docker exec api-extracao-texto node test/e2e/gerar-amostras.js
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar amostras' }

docker exec api-extracao-texto node test/e2e/testar-api.js
$codigo = $LASTEXITCODE

Write-Host ''
Write-Host "API continua no ar em http://localhost:$HostPort/extrair"
Write-Host "Para parar: docker compose -f `"$compose`" down"
exit $codigo
