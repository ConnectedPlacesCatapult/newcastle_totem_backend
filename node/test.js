const MongoClient = require('mongodb').MongoClient;
const assert = require('assert');

const mongoURL = 'mongodb://localhost:27017';
const mongoName = 'totem_backend';

function mongoExec(method, collection, data) {
  MongoClient.connect(mongoURL, function(err, client) {

    assert.equal(null, err);
    console.log("Connected to Mongo server")
    const db = client.db(mongoName)

    method(db, collection, data, function() {
      client.close()
    });

  });
}

function mongoInsertOne(db, collection, data, callback) {
  const col = db.collection(collection);
  col.insert(data, function(err, res) {
    assert.equal(err, null);
    console.log("Successfully inserted");
    callback(res);
  });
}


var d = {content:"works"}

mongoExec(mongoInsertOne, "log_ili", d);
