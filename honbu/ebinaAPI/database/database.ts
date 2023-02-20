import { Mutex } from "semaphore";
import { ConnectOptions, Document, MongoClient } from "mongo";
import { Hono } from "hono/mod.ts";
import { Settings } from "../../project_data/settings/mod.ts";
import { authToken, AuthTokenVariables } from "../../auth_manager/token.ts";
import { logEbina } from "../../utils/log.ts";

const databaseRouter = new Hono<{ Variables: AuthTokenVariables }>();

const client = new MongoClient();
const mutex = new Mutex();

const initClient = async () => {
  const settings = Settings.instance();
  const mongodbSettings = settings.Mongodb;
  if (!mongodbSettings) return;
  await mutex.use(async () => {
    if (client.buildInfo) return;
    logEbina.info("start init db");
    const op: ConnectOptions = {
      db: "admin",
      servers: [{ host: "localhost", port: mongodbSettings.getPortNumber() }],
      credential: {
        username: mongodbSettings.getMongodbUsername(),
        password: mongodbSettings.getMongodbPassword(),
        db: "admin",
        mechanism: "SCRAM-SHA-1",
      },
    };
    await client.connect(op);
  });
};

databaseRouter.get("/", authToken, async (c) => {
  await initClient();
  const mongodbSettings = Settings.instance().Mongodb;
  let filter: Document | undefined = undefined;
  const names = mongodbSettings.getFilterEnabledDBNames();
  filter = { name: { "$nin": names } };
  const list = await client.listDatabases({ filter });
  return c.json(list);
});

databaseRouter.get("/:db", authToken, async (c) => {
  const dbName = c.req.param().db;
  const mongodbSettings = Settings.instance().Mongodb;
  const filter = mongodbSettings.getDBFilterByName(dbName);
  if (filter && filter.enable) return c.json({}, 403);

  await initClient();
  const db = client.database(dbName);
  return c.json(await db.listCollectionNames());
});

databaseRouter.get("/:db/:collection/find", authToken, async (c) => {
  const params = c.req.param();
  const dbName = params.db;
  const mongodbSettings = Settings.instance().Mongodb;
  const filter = mongodbSettings.getDBFilterByName(dbName);
  if (filter && filter.enable) return c.json({}, 403);

  const collectionName = params.collection;
  await initClient();
  const db = client.database(dbName);
  const collection = db.collection(collectionName);
  try {
    const docs = await collection.find().toArray();
    return c.json(docs);
  } catch (err) {
    return c.json(err, 500);
  }
});

databaseRouter.get("/user", authToken, async (c) => {
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
    return c.json(docs);
  } catch (err) {
    return c.json(err, 500);
  }
});

databaseRouter.post("/user", authToken, async (c) => {
  const body = await c.req.json<{
    username?: string;
    password?: string;
    roles?: { role: string; db: string }[];
  }>();
  const { username, password, roles } = body;
  if (!username || !password || !roles) {
    return c.json({}, 400);
  }

  await initClient();
  const db = client.database("admin");
  try {
    const user = await db.createUser(username, password, { roles });
    return c.json(user);
  } catch (err) {
    return c.json(err, 500);
  }
});

databaseRouter.delete("/user/:username", authToken, async (c) => {
  const { username }: { username?: string } = c.req.param();
  if (!username) {
    return c.json({}, 400);
  }
  await initClient();
  const db = client.database("admin");
  try {
    const res = await db.dropUser(username);
    return c.json(res);
  } catch (err) {
    return c.json(err, 500);
  }
});

export default databaseRouter;
