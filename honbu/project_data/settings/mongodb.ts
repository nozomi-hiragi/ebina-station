export interface SettingMongodbValues {
  port: number;
  username: "env" | string;
  password: "env" | string;
  databaseFilter: { [databaseName: string]: { enable: boolean } | undefined };
}
const DEFAULT_MONGODB_PORT = 27017;

const DEFAULT_SETTINGS_VALUE_MONGODB: SettingMongodbValues = {
  port: DEFAULT_MONGODB_PORT,
  username: "env",
  password: "env",
  databaseFilter: {
    admin: { enable: true },
    config: { enable: true },
    local: { enable: true },
  },
};

export class MongodbSettings {
  values: SettingMongodbValues;

  constructor(values: SettingMongodbValues = DEFAULT_SETTINGS_VALUE_MONGODB) {
    this.values = values;
  }
  getRawValue = () => this.values;

  getPortNumber = () => this.values.port;

  getMongodbUsername() {
    const values = this.values;
    if (values.username !== "env") return values.username;
    return Deno.env.get("MONGO_INITDB_ROOT_USERNAME");
  }

  getMongodbPassword() {
    const values = this.values;
    if (values.password !== "env") return values.password;
    return Deno.env.get("MONGO_INITDB_ROOT_PASSWORD");
  }

  getDBFilterByName(name: string) {
    return this.values.databaseFilter[name];
  }

  getFilterEnabledDBNames() {
    return Object.keys(this.values.databaseFilter)
      .filter((name) => this.getDBFilterByName(name)?.enable);
  }
}
