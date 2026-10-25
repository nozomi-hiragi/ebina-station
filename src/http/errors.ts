/** リクエストの形が正しくないとき。メッセージはそのままクライアントに返す */
export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}
