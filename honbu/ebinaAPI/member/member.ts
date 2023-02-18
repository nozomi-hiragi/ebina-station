import { isString } from "std/encoding/_yaml/utils.ts";
import { Hono } from "hono/mod.ts";
import { authToken, JwtPayload } from "../../auth_manager/token.ts";
import { Members } from "../../project_data/members/mod.ts";
import { AuthManager, handleAMErrorToStatus } from "../../auth_manager/mod.ts";
import {
  AttestationResponseJSON,
  AuthenticationResponseJSON,
} from "../../webauthn/fido2Wrap.ts";

const memberRouter = new Hono();

// ユーザー登録リクエスト
// { front, server, id, name }
// 20
// 400 パラメ足らん
// 409 メンバー上限
// 500 URLエラー
memberRouter.post("/regist/request", authToken, async (c) => {
  const payload: JwtPayload = c.get<JwtPayload>("payload");
  let { front, server, id, name } = await c.req.json<
    { front: string; server: string; id: string; name: string }
  >();

  const reqURL = new URL(c.req.url);
  if (!server) server = `${reqURL.protocol}//${reqURL.host}`;
  if (!isString(server)) return c.json({}, 400);

  if (!front) {
    const origin = c.req.headers.get("origin");
    if (!origin) return c.json({}, 400);
    front = `${origin}/ebina-station`;
  }
  if (!isString(front)) return c.json({}, 400);

  const token = AuthManager.instance().getRegistNewMemeberToken(payload.id);
  if (!token) return c.json({}, 409);

  let url: string | undefined = undefined;
  try {
    const registURL = new URL(`${front}/regist`);
    registURL.searchParams.set("t", token);
    registURL.searchParams.set("s", server);
    if (id && isString(id)) registURL.searchParams.set("i", id);
    if (name && isString(name)) registURL.searchParams.set("n", name);
    url = registURL.toString();
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
  }
  return c.json({ token, url }, 201);
});

// 仮登録
// { id, name, pass }
// 201 オプションあげる
// 400 パラメ足らん
// 409 メンバ競合
memberRouter.post("/regist/option", async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const { id, name, pass, token } = await c.req.json<
    { id: string; name: string; pass: string; token: string }
  >();
  if (!id || !name || !pass || !token) return c.json({}, 400);

  try {
    const option = await AuthManager.instance()
      .registTempMemberOption(origin, token, id, name, pass);
    return c.json(option, 201);
  } catch (err) {
    return c.json({}, handleAMErrorToStatus(err));
  }
});

// 仮登録認証
// { id, name, pass }
// 200 できた
// 400 パラメ足らん
// 401 トークン違う
// 404 いない
memberRouter.post("/regist/verify", async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const body = await c.req.json<
    { id: string; result: AttestationResponseJSON }
  >();
  const { id, result } = body;
  if (!id || !isString(id) || !result) {
    return c.json({}, 400);
  }

  try {
    await AuthManager.instance().registTempMemberVerify(origin, id, result);
    return c.json({}, 200);
  } catch (err) {
    return c.json({}, handleAMErrorToStatus(err));
  }
});

// メンバー配列取得 ID無いなら全部
// ?ids
// 200 空でも返す
memberRouter.get("/", authToken, (c) => {
  const ids = c.req.query("ids")?.split(",") ?? [];

  return c.json(Members.instance().getMembersArray(ids));
});

// メンバー配列削除
// ?ids
// 200 全部できた
// 206 一部できた
// 404 全部できない
memberRouter.delete("/", authToken, (c) => {
  const payload = c.get<JwtPayload>("payload");
  const ids = c.req.query("ids")?.split(",") ?? [];

  const failedIds: string[] = [];
  ids.forEach((id) => {
    if (id === payload?.id) return;
    if (!Members.instance().removeMember(id)) failedIds.push(id);
  });
  if (failedIds.length === ids.length) {
    return c.json({}, 404);
  } else if (failedIds.length !== 0) {
    return c.json({ failedIDs: failedIds }, 206);
  } else {
    return c.json({}, 200);
  }
});

// メンバー取得
// :id
// 200 メンバー
// 400 IDない
// 404 みつからない
memberRouter.get("/member/:id", authToken, (c) => {
  const { id } = c.req.param();
  if (!id) return c.json({}, 400);

  const member = Members.instance().getMember(id);
  if (member) {
    return c.json({ ...member, auth: undefined });
  } else {
    return c.json({}, 404);
  }
});

// 仮メンバーたち
// 200 ok
memberRouter.get("/temp", authToken, (c) => {
  const members = Members.instance().getTempMembers();
  const arrangedMembers = Object.keys(members).map((id) => {
    const member = members[id]!;
    return { id, from: member.from, member: member.member.getValue() };
  });

  return c.json(arrangedMembers, 200);
});

// 仮メンバー承認
// 200 ok
// 202 認証して
// 400 足らない
// 401 認証できてない
memberRouter.post("/temp/admit", authToken, async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 401);
  const body = await c.req.json<
    ({ type: "public-key" } & AuthenticationResponseJSON) | { ids: string[] }
  >();

  try {
    const am = AuthManager.instance();
    if ("type" in body && body.type === "public-key") {
      const successIds = await am.verifyAuthResponse(origin, payload.id, body);
      return c.json(successIds, 200);
    } else {
      const ids = "ids" in body ? body.ids : undefined;
      if (!ids || !Array.isArray(ids)) return c.json({}, 400);

      const option = await am.createAuthOption(origin, payload.id, {
        id: payload.id,
        action: () => {
          const successIds = ids
            .filter((id) => Members.instance().admitTempMember(id));
          return Promise.resolve(successIds);
        },
      });
      return c.json(option, 202);
    }
  } catch (err) {
    return c.json({}, handleAMErrorToStatus(err));
  }
});

// 仮メンバー否認
// 200 ok
// 202 認証して
// 400 足らない
// 401 認証できてない
memberRouter.post("/temp/deny", authToken, async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 401);
  const body = await c.req.json<
    ({ type: "public-key" } & AuthenticationResponseJSON) | { ids: string[] }
  >();

  try {
    const am = AuthManager.instance();
    if ("type" in body && body.type === "public-key") {
      const failedIds = await am.verifyAuthResponse(origin, payload.id, body);
      return c.json(failedIds, 200);
    } else {
      const ids = "ids" in body ? body.ids : undefined;
      if (!ids || !Array.isArray(ids)) return c.json({}, 400);

      const option = await am.createAuthOption(origin, payload.id, {
        id: payload.id,
        action: () => {
          const successIds = ids
            .filter((id) => Members.instance().denyTempMember(id));
          return Promise.resolve(successIds);
        },
      });
      return c.json(option, 202);
    }
  } catch (err) {
    return c.json({}, handleAMErrorToStatus(err));
  }
});

export default memberRouter;
