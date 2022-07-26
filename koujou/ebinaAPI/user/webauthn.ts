import { base64, oak } from "../../deps.ts";
import { Fido2Lib } from "https://deno.land/x/fido2@3.2.4/dist/main.js";
import {
  FMT,
  getMember,
  setMember,
  WebAuthn,
  WebAuthnAuthenticator,
  WebAuthnItem,
} from "../../data/members.ts";
import { getSettings, WebAuthnSetting } from "../../data/settings.ts";
import { authToken, JwtPayload } from "../../utils/auth.ts";
import {
  AssertionExpectations,
  PublicKeyCredentialCreationOptions,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptions,
  PublicKeyCredentialRequestOptionsJSON,
} from "../../utils/webauthn.ts";

const challenges: {
  [key: string]: {
    challenge: string;
    createdAt: number;
  } | undefined;
} = {};

const isRPIDStatic = (webAuthnSetting: WebAuthnSetting) => {
  switch (webAuthnSetting.rpIDType) {
    case "variable":
      return false;

    default:
    case "static":
      return true;
  }
};

const webauthnRouter = new oak.Router();

// 登録オプション取得
// origin:
// 200 オプション
// 400 オリジンヘッダない
// 404 メンバーがない
// 500 WebAuthnの設定おかしい
webauthnRouter.get("/regist", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const originURL = new URL(origin);

  const payload: JwtPayload = ctx.state.payload!;
  const member = getMember(payload.id);
  if (!member) return ctx.response.status = 404;

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) {
    ctx.response.status = 500;
    return ctx.response.body = { message: "No WebAuthn setting" };
  }

  const rpID = isRPIDStatic(webAuthnSetting)
    ? webAuthnSetting.rpID
    : originURL.hostname;
  if (!rpID) {
    ctx.response.status = 500;
    return ctx.response.body = { message: "No rpID value" };
  }

  const userWebAuthn: WebAuthn = member.auth.webAuthn ?? {};
  const webAuthnItem: WebAuthnItem = userWebAuthn[rpID] ??
    { authenticators: {} };
  const f2l = new Fido2Lib({
    rpId: rpID,
    rpName: webAuthnSetting.rpName,
    challengeSize: 128,
    attestation: webAuthnSetting.attestationType,
    cryptoParams: [-7, -36, -37, -38, -39, -257, -258, -259],
    authenticatorRequireResidentKey: false,
    authenticatorUserVerification: "preferred",
  });
  const options = await f2l
    .attestationOptions() as PublicKeyCredentialCreationOptions;
  const optionsJson: PublicKeyCredentialCreationOptionsJSON = {
    ...options,
    user: {
      id: payload.id,
      name: member.name,
      displayName: member.name,
    },
    challenge: base64.encode(options.challenge),
    excludeCredentials: Object.values(webAuthnItem.authenticators).filter((
      authenticator,
    ) => authenticator !== undefined).map((authenticator) => ({
      type: authenticator!.credentialType,
      id: authenticator!.credentialID,
      transports: authenticator!.transports,
    })),
  };

  challenges[payload.id] = {
    challenge: optionsJson.challenge,
    createdAt: Date.now(),
  };
  ctx.response.body = optionsJson;
});

// 登録
// origin:
// { ...credential, deviceName }
// 200 OK
// 400 情報おかしい
// 401 チャレンジ失敗
// 404 メンバーがない
// 409 チャレンジ控えがない
// 410 チャレンジ古い
// 500 WebAuthnの設定おかしい
webauthnRouter.post("/regist", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const originURL = new URL(origin);

  const body = await ctx.request.body({ type: "json" }).value;
  const { deviceName } = body;
  if (!deviceName) return ctx.response.status = 400;

  const payload: JwtPayload = ctx.state.payload!;
  const member = getMember(payload.id);
  if (!member) return ctx.response.status = 404;

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) {
    ctx.response.status = 500;
    return ctx.response.body = { message: "No WebAuthn setting" };
  }

  const rpID = isRPIDStatic(webAuthnSetting)
    ? webAuthnSetting.rpID
    : originURL.hostname;
  if (!rpID) {
    ctx.response.status = 500;
    return ctx.response.body = { message: "No rpID value" };
  }

  const userWebAuthn: WebAuthn = member.auth.webAuthn ?? {};
  const webAuthnItem: WebAuthnItem = userWebAuthn[rpID] ??
    { authenticators: {} };
  if (webAuthnItem.authenticators[deviceName]) {
    ctx.response.status = 400;
    return ctx.response.body = { message: "Already used this device name" };
  }

  const challengeItem = challenges[payload.id];
  if (!challengeItem) return ctx.response.status = 409;
  delete challenges[payload.id];
  if ((Date.now() - challengeItem.createdAt) > (1000 * 60)) {
    return ctx.response.status = 410;
  }

  const f2l = new Fido2Lib({
    rpId: rpID,
    rpName: webAuthnSetting.rpName,
    challengeSize: 128,
    attestation: webAuthnSetting.attestationType,
    cryptoParams: [-7, -36, -37, -38, -39, -257, -258, -259],
    authenticatorRequireResidentKey: false,
    authenticatorUserVerification: "preferred",
  });

  body.response.attestationObject = base64.decode(
    body.response.attestationObject,
  ).buffer;
  body.rawId = base64.decode(body.rawId).buffer;

  const attestationExpectations = {
    challenge: challengeItem.challenge,
    origin,
    factor: "either",
  };
  const verification = await f2l.attestationResult(
    body,
    attestationExpectations,
  );
  ctx.response.body = verification;

  webAuthnItem.authenticators[deviceName] = {
    fmt: verification.authnrData!.get("fmt") as FMT,
    alg: verification.authnrData!.get("alg"),
    counter: verification.authnrData!.get("counter"),
    aaguid: base64.encode(verification.authnrData!.get("aaguid")),
    credentialID: base64.encode(verification.authnrData!.get("credId")),
    credentialPublicKey: verification.authnrData!.get("credentialPublicKeyPem"),
    transports: verification.authnrData!.get("transports"),
    credentialType: "public-key",
  };
  userWebAuthn[rpID] = webAuthnItem;
  member.auth.webAuthn = userWebAuthn;
  setMember(payload.id, member);

  ctx.response.status = 200;
});

// 確認用オプション取得
// origin:
// ?names[]
// 200 オプション
// 400 情報足りない
// 404 メンバーがない
// 500 WebAuthnの設定おかしい
webauthnRouter.get("/verify", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const originURL = new URL(origin);

  const payload: JwtPayload = ctx.state.payload!;
  const member = getMember(payload.id);
  if (!member) return ctx.response.status = 404;

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) {
    ctx.response.status = 500;
    return ctx.response.body = { message: "No WebAuthn setting" };
  }

  const rpID = isRPIDStatic(webAuthnSetting)
    ? webAuthnSetting.rpID
    : originURL.hostname;
  if (!rpID) {
    ctx.response.status = 500;
    return ctx.response.body = { message: "No rpID value" };
  }

  const userWebAuthn: WebAuthn = member.auth.webAuthn ?? {};
  const webAuthnItem: WebAuthnItem = userWebAuthn[rpID] ??
    { authenticators: {} };

  const queryDeviceNames = ctx.request.url.searchParams
    .get("names")?.split(",") ?? [];
  const deviceNames = queryDeviceNames.length
    ? queryDeviceNames
    : Object.keys(webAuthnItem.authenticators);

  const authenticators = deviceNames
    .map((deviceNames) => webAuthnItem.authenticators[deviceNames])
    .filter((a) => a) as WebAuthnAuthenticator[];

  const f2l = new Fido2Lib({
    rpId: rpID,
    rpName: webAuthnSetting.rpName,
    challengeSize: 128,
    attestation: webAuthnSetting.attestationType,
    cryptoParams: [-7, -36, -37, -38, -39, -257, -258, -259],
    authenticatorRequireResidentKey: false,
    authenticatorUserVerification: "preferred",
  });
  const option = await f2l
    .assertionOptions() as PublicKeyCredentialRequestOptions;
  const optionsJson: PublicKeyCredentialRequestOptionsJSON = {
    challenge: base64.encode(option.challenge),
    extensions: option.extensions,
    rpId: option.rpId,
    timeout: option.timeout,
    userVerification: option.userVerification,
    allowCredentials: authenticators.map((authenticator) => ({
      id: authenticator.credentialID,
      type: authenticator.credentialType,
      transports: authenticator.transports,
    })),
  };
  challenges[payload.id] = {
    challenge: optionsJson.challenge,
    createdAt: Date.now(),
  };
  ctx.response.body = optionsJson;
});

// 認証
// origin:
// { ...credential }
// 200 OK
// 400 情報おかしい
// 401 チャレンジ失敗
// 404 ものがない
// 405 パスワードが設定されてない
// 409 チャレンジ控えがない
// 410 チャレンジ古い
// 500 WebAuthnの設定おかしい
webauthnRouter.post("/verify", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const originURL = new URL(origin);
  const body = await ctx.request.body({ type: "json" }).value;

  const payload: JwtPayload = ctx.state.payload!;
  const member = getMember(payload.id);
  if (!member) return ctx.response.status = 404;

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) {
    ctx.response.status = 500;
    return ctx.response.body = { message: "No WebAuthn setting" };
  }

  const rpID = isRPIDStatic(webAuthnSetting)
    ? webAuthnSetting.rpID
    : originURL.hostname;
  if (!rpID) {
    ctx.response.status = 500;
    return ctx.response.body = { message: "No rpID value" };
  }

  const userWebAuthn: WebAuthn = member.auth.webAuthn ?? {};
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID];
  if (!webAuthnItem) return ctx.response.status = 400;

  const challengeItem = challenges[payload.id];
  if (!challengeItem) return ctx.response.status = 409;
  delete challenges[payload.id];
  if ((Date.now() - challengeItem.createdAt) > (1000 * 60)) {
    return ctx.response.status = 410;
  }

  const deviceName = Object.keys(webAuthnItem.authenticators).find(
    (deviceName) => {
      const authenticator = webAuthnItem.authenticators[deviceName];
      if (!authenticator) return false;
      return authenticator.credentialID === body.id;
    },
  );
  if (!deviceName) {
    ctx.response.status = 404;
    return ctx.response.body = {
      message: "Can't find device from this credential id",
    };
  }

  body.rawId = base64.decode(body.rawId).buffer;
  body.response.userHandle = body.rawId;
  const f2l = new Fido2Lib({
    rpId: rpID,
    rpName: webAuthnSetting.rpName,
    challengeSize: 128,
    attestation: webAuthnSetting.attestationType,
    cryptoParams: [-7, -36, -37, -38, -39, -257, -258, -259],
    authenticatorRequireResidentKey: false,
    authenticatorUserVerification: "preferred",
  });
  const authenticator = webAuthnItem.authenticators[deviceName]!;
  const assertionExpectations: AssertionExpectations = {
    challenge: challengeItem.challenge,
    origin,
    factor: "either",
    publicKey: authenticator.credentialPublicKey,
    prevCounter: authenticator.counter,
    userHandle: authenticator.credentialID,
  };
  const verification = await f2l.assertionResult(body, assertionExpectations);

  if (!verification) {
    return ctx.response.status = 401;
  }

  webAuthnItem.authenticators[deviceName]!.counter = verification.authnrData
    ?.get("counter");
  userWebAuthn[rpID] = webAuthnItem;
  member.auth.webAuthn = userWebAuthn;
  setMember(payload.id, member);

  ctx.response.status = 200;
});

// デバイスら情報取得
// origin:
// ?names
// 200 空でも返す
// 400 情報足りない
// 500 WebAuthnの設定おかしい
webauthnRouter.get("/device", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const originURL = new URL(origin);

  const deviceNames: string[] =
    ctx.request.url.searchParams.get("names")?.split(",") ?? [];

  const payload: JwtPayload = ctx.state.payload!;
  const member = getMember(payload.id);
  if (!member) return ctx.response.status = 404;

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) return ctx.response.status = 500;

  const rpID = isRPIDStatic(webAuthnSetting)
    ? webAuthnSetting.rpID
    : originURL.hostname;
  if (!rpID) return ctx.response.status = 500;

  const userWebAuthn: WebAuthn = member.auth.webAuthn ?? {};
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID];
  const authenticatorNames = webAuthnItem
    ? Object.keys(webAuthnItem.authenticators)
    : [];

  ctx.response.body = deviceNames.length === 0
    ? authenticatorNames
    : authenticatorNames.filter((name) => deviceNames.includes(name));
});

// デバイスら削除
// origin:
// :deviceName
// ?names
// 200 OK
// 404 みつからない
// 500 WebAuthnの設定おかしい
webauthnRouter.delete("/device", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const originURL = new URL(origin);

  const deviceNames = ctx.request.url.searchParams
    .get("names")?.split(",") ?? [];

  const payload: JwtPayload = ctx.state.payload!;
  const user = getMember(payload.id);
  if (!user) return ctx.response.status = 404;

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) return ctx.response.status = 500;

  const rpID = isRPIDStatic(webAuthnSetting)
    ? webAuthnSetting.rpID
    : originURL.hostname;
  if (!rpID) return ctx.response.status = 500;

  const userWebAuthn: WebAuthn = user.auth.webAuthn ?? {};
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID];
  const authenticatorNames = Object.keys(webAuthnItem?.authenticators ?? {});
  if (!webAuthnItem || authenticatorNames.length === 0) {
    ctx.response.status = 404;
    return ctx.response.body = { message: "Disable WebAuthn on this account" };
  }

  const failedNames: string[] = [];
  authenticatorNames.forEach((name) => {
    const isTarget = deviceNames ? deviceNames.includes(name) : true;
    if (!isTarget) return;
    if (webAuthnItem.authenticators[name]) {
      delete webAuthnItem.authenticators[name];
    } else {
      failedNames.push(name);
    }
  });

  userWebAuthn[rpID] = webAuthnItem;
  user.auth.webAuthn = userWebAuthn;
  setMember(payload.id, user);

  if (failedNames.length === 0) {
    ctx.response.status = 200;
  } else if (failedNames.length === deviceNames.length) {
    ctx.response.status = 404;
    ctx.response.body = { message: "Can't find all devices" };
  } else {
    ctx.response.status = 206;
    ctx.response.body = { failedNames: failedNames };
  }
});

// デバイス情報取得
// origin:
// :deviceName
// 200 空でも返す
// 400 情報足りない
// 404 みつからない
// 500 WebAuthnの設定おかしい
webauthnRouter.get("/device/:deviceName", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const originURL = new URL(origin);

  const { deviceName } = ctx.params;
  if (!deviceName) return ctx.response.status = 400;

  const payload = ctx.state.payload!;
  const member = getMember(payload.id);
  if (!member) return ctx.response.status = 404;

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) return ctx.response.status = 500;

  const rpID = isRPIDStatic(webAuthnSetting)
    ? webAuthnSetting.rpID
    : originURL.hostname;
  if (!rpID) return ctx.response.status = 500;

  const userWebAuthn: WebAuthn = member.auth.webAuthn ?? {};
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID];

  const device = webAuthnItem?.authenticators[deviceName];
  if (device) {
    ctx.response.body = deviceName;
  } else {
    ctx.response.status = 404;
  }
});

// デバイス削除
// origin:
// :deviceName
// 200 OK
// 404 みつからない
// 500 WebAuthnの設定おかしい
webauthnRouter.delete("/device/:deviceName", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const originURL = new URL(origin);

  const { deviceName } = ctx.params;
  if (!deviceName) return ctx.response.status = 400;

  const payload = ctx.state.payload!;
  const user = getMember(payload.id);
  if (!user) return ctx.response.status = 404;

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) return ctx.response.status = 500;

  const rpID = isRPIDStatic(webAuthnSetting)
    ? webAuthnSetting.rpID
    : originURL.hostname;
  if (!rpID) return ctx.response.status = 500;

  const userWebAuthn: WebAuthn = user.auth.webAuthn ?? {};
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID];
  if (!webAuthnItem) {
    ctx.response.status = 404;
    return ctx.response.body = {
      message: "Disable WebAuthn on this account",
    };
  }

  const authenticator = webAuthnItem.authenticators[deviceName];
  if (!authenticator) {
    ctx.response.status = 404;
    return ctx.response.body = { message: "Can't find this device" };
  }

  delete webAuthnItem.authenticators[deviceName];
  userWebAuthn[rpID] = webAuthnItem;
  user.auth.webAuthn = userWebAuthn;
  setMember(payload.id, user);

  ctx.response.status = 200;
});

export default webauthnRouter;
