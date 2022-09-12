import { mongodb, Mutex, oak } from "../../../deps.ts";
import { getSettings } from "../../../settings/settings.ts";
import { authToken } from "../../../utils/auth.ts";

const databaseRouter = new oak.Router();

const client = new mongodb.MongoClient();
const mutex = new Mutex();

const initClient = async () => {
  const settings = getSettings();
  const mongodbSettings = settings.mongodb;
  if (!mongodbSettings) return;
  await mutex.use(async () => {
    if (client.buildInfo) return;
    console.log("start init db");
    const op: mongodb.ConnectOptions = {
      db: "admin",
      servers: [
        {
          host: Deno.env.get("HONBU") === "true"
            ? "EbinaStationDB"
            : "localhost",
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
  });
};

databaseRouter.get("/", authToken, async (ctx) => {
  await initClient();
  const mongodbSettings = getSettings().mongodb;
  let filter: mongodb.Document | undefined = undefined;
  if (mongodbSettings) {
    const names = Object.keys(mongodbSettings.databaseFilter).filter((name) =>
      mongodbSettings.databaseFilter[name].enable
    );
    filter = { name: { "$nin": names } };
  }
  const list = await client.listDatabases({ filter });
  ctx.response.body = list;
});

databaseRouter.get("/:db", authToken, async (ctx) => {
  const dbName = ctx.params.db;
  const mongodbSettings = getSettings().mongodb;
  if (mongodbSettings) {
    const filter = mongodbSettings.databaseFilter[dbName];
    if (filter && filter.enable) return ctx.response.status = 403;
  }

  await initClient();
  const db = client.database(dbName);
  ctx.response.body = await db.listCollectionNames();
});

databaseRouter.get("/:db/:collection/find", authToken, async (ctx) => {
  const dbName = ctx.params.db;
  const mongodbSettings = getSettings().mongodb;
  if (mongodbSettings) {
    const filter = mongodbSettings.databaseFilter[dbName];
    if (filter && filter.enable) return ctx.response.status = 403;
  }

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

databaseRouter.get("/user", authToken, async (ctx) => {
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
