import { mongodb, oak } from "../../deps.ts";
import { getSettings } from "../../project_data/settings.ts";
import { authToken } from "../../utils/auth.ts";

const databaseRouter = new oak.Router();

const client = new mongodb.MongoClient();

const initClient = async () => {
  const settings = getSettings();
  const mongodbSettings = settings.mongodb;
  if (!client.buildInfo && mongodbSettings) {
    console.log("start init db");
    const op: mongodb.ConnectOptions = {
      db: "admin",
      servers: [
        {
          host: mongodbSettings.hostname,
          port: mongodbSettings.port,
        },
      ],
      credential: {
        username: settings.getMongodbUsername(),
        password: settings.getMongodbPassword(),
        db: "admin",
        mechanism: "SCRAM-SHA-1",
      },
    };
    await client.connect(op);
  }
};

databaseRouter.get("/databases", authToken, async (ctx) => {
  await initClient();
  const list = await client.listDatabases();
  ctx.response.body = list;
});

databaseRouter.get("/:db/collections", authToken, async (ctx) => {
  const dbName = ctx.params.db;
  await initClient();
  const db = client.database(dbName);
  ctx.response.body = await db.listCollectionNames();
});

databaseRouter.get("/:db/:collection/find", authToken, async (ctx) => {
  const dbName = ctx.params.db;
  const collectionName = ctx.params.collection;
  await initClient();
  const db = client.database(dbName);
  const collection = db.collection(collectionName);
  try {
    const docs = await collection.find().toArray();
    ctx.response.body = docs;
  } catch (err) {
    ctx.response.status = 500;
    ctx.response.body = err;
  }
});

databaseRouter.get("/users", authToken, async (ctx) => {
  await initClient();
  const db = client.database("admin");
  const collection = db.collection("system.users");
  try {
    const docs = (await collection.find().toArray()).map((doc) => {
      return {
        user: doc.user,
        roles: doc.roles,
      };
    });
    ctx.response.body = docs;
  } catch (err) {
    ctx.response.status = 500;
    ctx.response.body = err;
  }
});

databaseRouter.post("/user", authToken, async (ctx) => {
  const body = await ctx.request.body({ type: "json" }).value;
  const { username, password, roles }: {
    username?: string;
    password?: string;
    roles?: { role: string; db: string }[];
  } = body;
  if (!username || !password || !roles) {
    return ctx.response.status = 401;
  }

  await initClient();
  const db = client.database("admin");
  try {
    const user = await db.createUser(username, password, { roles });
    ctx.response.body = user;
  } catch (err) {
    ctx.response.status = 500;
    ctx.response.body = err;
  }
});

databaseRouter.delete("/user/:username", authToken, async (ctx) => {
  const { username }: { username?: string } = ctx.params;
  if (!username) {
    return ctx.response.status = 401;
  }
  await initClient();
  const db = client.database("admin");
  try {
    const res = await db.dropUser(username);
    ctx.response.body = res;
  } catch (err) {
    ctx.response.status = 500;
    ctx.response.body = err;
  }
});

export default databaseRouter;
