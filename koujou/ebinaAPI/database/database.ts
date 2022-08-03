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

export default databaseRouter;
