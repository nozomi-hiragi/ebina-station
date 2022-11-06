import { parse, stringify } from "../deps.ts";

type DockerComposeYamlBase = {
  version: string;
  services: { [name: string]: DockerComposeYamlService };
};

export type DockerComposeYamlService = {
  image: string;
  build?: string;
  container_name?: string;
  volumes: string[];
  ports?: string[];
  env_file?: string;
  environment?: string[];
  network_mode?: string;
  command?: string;
  restart?: string;
  depends_on?: string[];
};

export class DockerComposeYamlManager {
  data: DockerComposeYamlBase = {
    version: "3.7",
    services: {},
  };

  constructor(path?: string) {
    if (path) this.loadFromFile(path);
  }

  loadFromFile(path: string) {
    try {
      this.data = {
        ...parse(Deno.readTextFileSync(path)) as DockerComposeYamlBase,
      };
      return true;
    } catch (err) {
      console.log(err.message);
      return false;
    }
  }

  saveToFile(path = "docker-compose.yml") {
    try {
      Deno.writeTextFileSync(path, this.toYamlString());
      return true;
    } catch (err) {
      console.log(err.message);
      return false;
    }
  }

  setService(name: string, service: DockerComposeYamlService) {
    this.data.services[name] = service;
  }

  getService(name: string) {
    return Object.keys(this.data.services).includes(name)
      ? this.data.services[name]
      : undefined;
  }

  toYamlString() {
    return stringify(this.data);
  }
}
