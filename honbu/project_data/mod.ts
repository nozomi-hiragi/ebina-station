import { ReaderBuffer } from "../utils/utils.ts";
import { getSettings, setSettings } from "./settings.ts";

export const initProjectSettingsInteract = async () => {
  const yon = "y/n";
  const msgPleaseChangeFromSettingFile = "変更する場合は設定ファイルから行ってください。\n";

  const rb = new ReaderBuffer(Deno.stdin);

  // Let's encrypt同意して
  console.log(
    "このアプリはcertbotコンテナを使用したLet's Encryptを使用してます。\n" +
      "Let's Encrypt Subscriber Agreementの同意が必要です。 https://letsencrypt.org/repository/\n" +
      "同意しますか？" + yon,
  );
  const agree = await rb.read().then((ret) => ret?.toLowerCase());
  if (agree !== "y") {
    console.log("同意できなきゃ多分使っちゃダメ");
    throw new Error("Not agree let's encrype agreement");
  }

  const projectSettings = getSettings();

  console.log(
    "こんにちは。\n" +
      "プロジェクトフォルダの設定をはじめます。\n",
  );

  console.log(
    "サーバーが許可するフロントのオリジンを設定します。\n" +
      `現在、${projectSettings.origins.join(", ")}が設定されてます。\n` +
      "追加しますか？" + yon,
  );
  while (await rb.read() !== null) {
    const buf = rb.message().toLocaleLowerCase();
    if (buf === "y") {
      console.log("カンマ区切りでオリジンを入れてください。");
      const ret = await rb.read();
      if (ret === null) throw new Error("input is null");

      const inputOrigin = ret.replaceAll(/\s+/g, "").split(",\n");
      console.log(
        `${inputOrigin}を追加します。\n` +
          msgPleaseChangeFromSettingFile,
      );
      projectSettings.origins = projectSettings.origins.concat(inputOrigin);
    } else if (buf === "n") {
      break;
    } else {
      console.log(yon);
    }
  }

  console.log(
    "WebAuthnの設定をします。\n" +
      "rpNameを入力してください。",
  );
  const rpName = await rb.read();
  if (rpName === null) throw new Error("input is null");

  console.log(
    `"${rpName}"に設定します。\n` +
      msgPleaseChangeFromSettingFile,
  );
  projectSettings.WebAuthn.rpName = rpName;

  console.log(
    "これにて設定は終わりです。\n" +
      "その他" + msgPleaseChangeFromSettingFile,
  );

  setSettings(projectSettings);
};
