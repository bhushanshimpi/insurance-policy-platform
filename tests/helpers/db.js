const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let server;

async function startMongo() {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
}

async function stopMongo() {
  await mongoose.disconnect();
  if (server) await server.stop();
  server = undefined;
}

async function clearMongo() {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}

module.exports = { startMongo, stopMongo, clearMongo };
