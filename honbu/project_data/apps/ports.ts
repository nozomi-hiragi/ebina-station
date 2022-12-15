import { logEbina } from "../../utils/log.ts";
import { isExist } from "../../utils/utils.ts";
import { APPS_DIR } from "../mod.ts";

interface PortsValues {
  [name: string]: number | undefined;
}

const PORTS_JSON_NAME = "ports.json";
export const PORT_START = 15346;

const ports: PortsValues = {};
const usedPort: number[] = [];

const parsePorts = (jsonString: string, appNames: string[]) => {
  const json = JSON.parse(jsonString);
  const keys = Object.keys(json);
  const rawPorts: number[] = [];
  keys.forEach((name) => {
    if (appNames.includes(name)) rawPorts.push(ports[name] = json[name]);
  });
  rawPorts.sort((a, b) => a - b);
  const double = rawPorts.filter((v, i, a) => {
    const isFindFirst = a.indexOf(v) === i;
    if (isFindFirst) usedPort.push(v);
    return isFindFirst && i !== a.lastIndexOf(v);
  });
  if (double.length !== 0) logEbina.error(`port overlap:`, double);
};

export const initPorts = (appNames: string[]) => {
  const portsPath = `${APPS_DIR}/${PORTS_JSON_NAME}`;
  isExist(portsPath)?.isFile
    ? parsePorts(Deno.readTextFileSync(portsPath), appNames)
    : [];
  appNames.forEach((name) => {
    if (name in ports) return;
    setPort(name, getNextPort(), { force: true, save: false });
  });
  savePorts();
};

const savePorts = () => {
  const portsPath = `${APPS_DIR}/${PORTS_JSON_NAME}`;
  try {
    Deno.writeTextFileSync(portsPath, JSON.stringify(ports, undefined, 2));
  } catch (err) {
    logEbina.error(`save ${PORTS_JSON_NAME} error:`, err);
  }
};

export const getNextPort = () => {
  const rangePorts = usedPort.filter((v) => v > PORT_START);
  return 1 + (rangePorts.find((n, i, a) => n + 1 !== a[i + 1]) ?? PORT_START);
};

export const setPort = (
  name: string,
  port: number,
  options: { force?: boolean; save?: boolean } = { force: false, save: true },
) => {
  if (options.force === false && usedPort.includes(port)) return false;
  const prevPort = ports[name];
  if (prevPort) {
    usedPort.find((v, i, a) => {
      if (v !== prevPort) return false;
      a[i] = port;
      return true;
    });
  } else usedPort.push(port);
  usedPort.sort((a, b) => a - b);
  ports[name] = port;
  if (options.save === true) savePorts();
  return true;
};

export const getPort = (name: string) => ports[name];

export const getPorts = () => ({ ...ports });
