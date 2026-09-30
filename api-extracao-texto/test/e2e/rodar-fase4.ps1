# Fase 4 no Windows: sobe a API no Docker, gera as amostras e roda os testes.
# Uso (na raiz extracao-dados):  .\api-extracao-texto\test\e2e\rodar-fase4.ps1 [-HostPort 3010] [-Ia]
# -Ia: exige que o Claude ache os medicamentos da comercial.pdf (IA_HABILITADA=true e ANTHROPIC_API_KEY no .env)
param(
    [int]$HostPort = 3010,
    [switch]$Ia
)

$ErrorActionPreference = 'Stop'
$raiz = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$compose = Join-Path $raiz 'infra\docker-compose.yml'
$composeDev = Join-Path $raiz 'infra\docker-compose.dev.yml'

$env:API_HOST_PORT = $HostPort
docker compose -f $compose -f $composeDev up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Falha ao subir o container da API' }

Write-Host 'Aguardando a API...'
for ($i = 0; $i -lt 30; $i++) {
    docker exec api-extracao-texto node -e "fetch('http://localhost:3010/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>$null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
}

# root: a API roda como "node", mas a pasta montada pode ter amostras de execuções antigas
docker exec -u root api-extracao-texto node test/e2e/gerar-amostras.js
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar amostras' }

docker exec api-extracao-texto node test/testar-mascara.js
$codigoMascara = $LASTEXITCODE

docker exec api-extracao-texto node test/testar-ia.js
$codigoIa = $LASTEXITCODE

docker exec api-extracao-texto node test/testar-verificacao.js
$codigoVerificacao = $LASTEXITCODE

docker exec -e "IA_TESTE=$($Ia.IsPresent.ToString().ToLower())" api-extracao-texto node test/e2e/testar-api.js
$codigo = ($LASTEXITCODE, $codigoMascara, $codigoIa, $codigoVerificacao | Measure-Object -Maximum).Maximum

Write-Host ''
Write-Host "API continua no ar em http://localhost:$HostPort/extrair"
Write-Host "Para parar: docker compose -f `"$compose`" -f `"$composeDev`" down"
exit $codigo
