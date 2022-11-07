import { isExist } from "./utils.ts";
import { getSettings } from "./settings/settings.ts";

export type NginxConf = {
  hostname: string;
  port: number | "koujou";
  ssl?: {
    certificate: string;
    certificateKey: string;
    trustedCertificate: string;
    dhparam?: string;
  };
  certbot?: boolean;
  certWebRoot?: boolean;
  resolver?: boolean;
};

const generateNginxConf = (
  name: string,
  conf: NginxConf,
) => {
  const port = conf.port === "koujou"
    ? getSettings().getPortNumber()
    : conf.port;

  let sslSettings = "";
  if (conf.certbot) {
    conf.ssl = {
      certificate: `/etc/letsencrypt/live/${conf.hostname}/fullchain.pem`,
      certificateKey: `/etc/letsencrypt/live/${conf.hostname}/privkey.pem`,
      trustedCertificate: `/etc/letsencrypt/live/${conf.hostname}/chain.pem`,
    };
    if (isExist("/etc/ssl/certs/dhparam.pem")) {
      conf.ssl.dhparam = "/etc/ssl/certs/dhparam.pem";
    }
  }
  if (conf.ssl) {
    sslSettings = `
    listen 443 ssl;
    listen [::]:443 ssl;
    ssl_certificate ${conf.ssl.certificate};
    ssl_certificate_key ${conf.ssl.certificateKey};${
      conf.ssl.dhparam
        ? `
    ssl_dhparam ${conf.ssl.dhparam};`
        : ""
    }
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 60m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate ${conf.ssl.trustedCertificate};`;
  }

  const content = `server {
    listen 80;
    listen [::]:80;
    server_name ${conf.hostname};
    location / {
        proxy_pass http://localhost:${port}/;
    }${
    conf.certWebRoot
      ? `
    location /.well-known/ {
      root /var/www/html;
    }`
      : ""
  }
${sslSettings}${
    conf.resolver
      ? `
    resolver 1.1.1.1 1.0.0.1 [2606:4700:4700::1111] [2606:4700:4700::1001] valid=300s; # Cloudflare
    resolver_timeout 5s;`
      : ""
  }}`;
  try {
    const generateDir = "./project/nginx/generate";
    if (!isExist(generateDir)) Deno.mkdirSync(generateDir, { recursive: true });
    Deno.writeTextFileSync(
      `./project/nginx/generate/${name}.conf`,
      content,
      {},
    );
    return undefined;
  } catch (err) {
    return err;
  }
};

export const generateNginxConfsFromJson = () => {
  const confsFilePath = "./project/nginx/confs.json";
  const generateDir = "./project/nginx/generate";

  if (isExist(generateDir)) Deno.removeSync(generateDir, { recursive: true });
  Deno.mkdirSync(generateDir, { recursive: true });

  if (!isExist(confsFilePath)) return;
  const confs = JSON.parse(Deno.readTextFileSync(confsFilePath));
  if (!confs) throw new Error("something wrong on ./project/nginx/confs.json");
  Object.keys(confs).forEach((name) => {
    const err = generateNginxConf(name, confs[name]);
    if (err) console.log(err);
  });
};
