/**
 * pm2 da API NestJS.
 * Uso no servidor: pm2 start infra/ecosystem.config.cjs --env production
 * API_TOKEN e SFTP_* vêm do .env em cwd (/opt/api-extracao-texto/.env, lido pelo @nestjs/config).
 * Não definir API_TOKEN aqui: variável do pm2 vence o .env e o Protheus (Z_MEDAPIT) passa a receber 401.
 * Porta: 3010 em desenvolvimento; 6177 em produção, onde o Protheus (ambiente CYWSXT_PROD)
 * chama http://10.1.5.14:6177/extrair-sftp.
 */
module.exports = {
  apps: [
    {
      name: 'api-extracao-texto',
      cwd: '/opt/api-extracao-texto',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
        PORT: 3010,
        OCR_TMP_DIR: '/var/tmp/ocr-extracao',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 6177,
        OCR_TMP_DIR: '/var/tmp/ocr-extracao',
      },
    },
  ],
};
