import { logConsole } from "../utils/log.ts";
import { ReaderBuffer } from "../utils/utils.ts";
import { initApps } from "./apps/mod.ts";
import { Members } from "./members/mod.ts";
import { Settings } from "./settings/mod.ts";

export const PROJECT_PATH = "./project";
export const SETTINGS_FILE_PATH = `${PROJECT_PATH}/settings.json`;
export const MEMBERS_FILE_PATH = `${PROJECT_PATH}/members.json`;

export const APPS_DIR = `${PROJECT_PATH}/apps`;
export const SH_DIR = `${PROJECT_PATH}/sh`;
export const GOMI_DIR = `${PROJECT_PATH}/gomi`;

export const NGINX_DIR = `${PROJECT_PATH}/nginx`;
export const NGINX_GENERATE_DIR = `${NGINX_DIR}/generate`;
export const NGINX_CONFS_FILE_PATH = `${NGINX_DIR}/confs.json`;

export const initProjectData = async () => {
  if (!Settings.instance().load()) {
    await initProjectSettingsInteract();
  }
  Members.instance().load();
  initApps();
};

const initProjectSettingsInteract = async () => {
  const yon = "y/n";
  const msgPleaseChangeFromSettingFile = "変更する場合は設定ファイルから行ってください。\n";

  const rb = new ReaderBuffer(Deno.stdin);

  // Let's encrypt同意して
  logConsole.info(
    "このアプリはcertbotコンテナを使用したLet's Encryptを使用してます。\n" +
      "Let's Encrypt Subscriber Agreementの同意が必要です。 https://letsencrypt.org/repository/\n" +
      "同意しますか？" + yon,
  );
  const agree = await rb.read().then((ret) => ret?.toLowerCase());
  if (agree !== "y") {
    logConsole.info("同意できなきゃ多分使っちゃダメ");
    throw new Error("Not agree let's encrype agreement");
  }

  const projectSettings = Settings.instance();

  logConsole.info(
    "こんにちは。\n" +
      "プロジェクトフォルダの設定をはじめます。\n",
  );

  logConsole.info(
    "サーバーが許可するフロントのオリジンを設定します。\n" +
      `現在、${projectSettings.origins.join(", ")}が設定されてます。\n` +
      "追加しますか？" + yon,
  );
  while (await rb.read() !== null) {
    const buf = rb.message().toLocaleLowerCase();
    if (buf === "y") {
      logConsole.info("カンマ区切りでオリジンを入れてください。");
      const ret = await rb.read();
      if (ret === null) throw new Error("input is null");

      const inputOrigin = ret.replaceAll(/\s+/g, "").split(",\n");
      logConsole.info(
        `${inputOrigin}を追加します。\n` +
          msgPleaseChangeFromSettingFile,
      );
      projectSettings.origins = projectSettings.origins.concat(inputOrigin);
    } else if (buf === "n") {
      break;
    } else {
      logConsole.info(yon);
    }
  }

  logConsole.info(
    "WebAuthnの設定をします。\n" +
      "rpNameを入力してください。",
  );
  const rpName = await rb.read();
  if (rpName === null) throw new Error("input is null");

  logConsole.info(
    `"${rpName}"に設定します。\n` +
      msgPleaseChangeFromSettingFile,
  );
  projectSettings.WebAuthn.setRpName(rpName);

  logConsole.info(
    "これにて設定は終わりです。\n" +
      "その他" + msgPleaseChangeFromSettingFile,
  );

  projectSettings.save();
};
