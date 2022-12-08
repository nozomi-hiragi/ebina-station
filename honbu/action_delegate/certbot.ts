import { TypeUtils } from "../deps.ts";
import { execDCCRun } from "../docker/DockerComposeCommand.ts";
import { ServiceName } from "../ebina_docker_compose.ts";

export const runCertbot = (commands: string[]) =>
  execDCCRun(ServiceName.certbot, commands);

export const certCertbot = (domains: string | string[], email?: string) => {
  return runCertbot([
    "certonly",
    "-n",
    "--agree-tos", // プロジェクト作成時に同意を得てる
    email ? `-m ${email}` : "--register-unsafely-without-email",
    "--webroot",
    "-w",
    "/var/www/html",
    ...(TypeUtils.isString(domains) ? [domains] : domains)
      .filter(Boolean)
      .map((domain) => `-d ${domain}`),
  ]);
};

export const renewCertbot = () => {
  return runCertbot(["renew"]);
};
